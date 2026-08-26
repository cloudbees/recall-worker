// Recall discovery pipeline.
//
// Moved verbatim (in behaviour) from app/api/discover/route.ts in the monolith.
// The only structural change is that it no longer builds an HTTP response — it
// returns a plain result object and throws on failure, leaving transport
// concerns to server.ts.
//
// Note this is deliberately *blocking*: the caller waits for the whole run. The
// progressive part is the database writes — appendRequirement fires per recall
// via onProgress, and the UI polls /api/compliance against those rows while the
// request is still open. Preserving that means Core API proxies this call and
// waits, rather than firing and forgetting.

import { recallDiscovery, type CompanyContext } from '../lib/recall/index.ts';
import type { DiscoveredRequirement } from '../lib/recall/index.ts';
import {
  webScrapingService,
  type WebsiteAnalysisResult,
} from '../lib/company-intelligence/web-scraper.ts';
import {
  employeeThresholds,
  type ThresholdRequirement,
} from '../lib/company-intelligence/employee-thresholds.ts';
import { activeDiscoveries } from '../lib/services/active-discoveries.ts';

import { tokenTracker } from '@recall/shared/ai/anthropic-client';
import { createCompany } from '@recall/shared/services/company';
import {
  createEmptyDiscovery,
  appendRequirement,
  updateDiscoveryStatus,
} from '@recall/shared/services/discovery';
import { findUserByEmail, linkUserToCompany } from '@recall/shared/services/user';

export interface DiscoveryInput {
  naicsCode?: string; // kept for compatibility, maps to productCategory
  productCategory?: string;
  supplyChainRole?: string;
  employeeCount: number;
  website?: string; // optional
  companyName?: string;
  state?: string;
  email?: string; // required for database persistence
  maxResults?: number;
  includeCPSC?: boolean;
}

export interface DiscoveryResult {
  success: boolean;
  naicsCode: string;
  companyName?: string;
  employeeCount: number;

  requirements: DiscoveredRequirement[];
  totalRequirements: number;

  companyIntelligence: {
    websiteAnalysis: WebsiteAnalysisResult | null;
    thresholdRequirements: ThresholdRequirement[];
    thresholdSummary: {
      total: number;
      applicable: number;
      byAgency: Record<string, number>;
    };
  };

  searchKeywords: string[];
  discoveredAt: string;

  companyId: string;
  discoveryId: string;
}

/** Thrown for input the caller got wrong; server.ts maps this to a 400. */
export class DiscoveryInputError extends Error {}

export async function runDiscovery(
  input: DiscoveryInput,
  clientSignal?: AbortSignal
): Promise<DiscoveryResult> {
  // Reset token tracker for this request
  tokenTracker.reset();

  const {
    naicsCode,
    productCategory: rawProductCategory,
    supplyChainRole,
    employeeCount,
    website,
    companyName,
    state,
    email,
    maxResults = 20,
  } = input;

  // Resolve product category (new field takes precedence, fallback to naicsCode)
  const productCategory = rawProductCategory || naicsCode || 'General';

  if (!email) {
    throw new DiscoveryInputError('Email is required for discovery');
  }

  console.log(
    `[worker] Recall Discovery for product category "${productCategory}", ${employeeCount} employees`
  );
  console.log(`[worker] Website: ${website || '(none provided)'}`);
  console.log(`[worker] Email: ${email}`);

  // Run website analysis (optional) and threshold evaluation in parallel
  const [websiteAnalysis, thresholdResults] = await Promise.all([
    website
      ? webScrapingService.scrapeCompanyWebsite(website)
      : Promise.resolve({
          confidence: 0,
          industryKeywords: [] as string[],
          potentialHazards: [] as string[],
          activities: [] as string[],
          products: [] as string[],
          services: [] as string[],
        } as WebsiteAnalysisResult),

    Promise.resolve({
      requirements: employeeThresholds.evaluateThresholds(employeeCount),
      summary: employeeThresholds.getSummary(employeeCount),
    }),
  ]);

  console.log(`[worker] Website analysis confidence: ${websiteAnalysis.confidence}%`);
  console.log(`[worker] Threshold requirements: ${thresholdResults.summary.applicable} apply`);

  const additionalKeywords = [
    ...websiteAnalysis.industryKeywords,
    ...websiteAnalysis.potentialHazards,
    ...websiteAnalysis.activities,
  ];

  const companyContext: CompanyContext = {
    companyName,
    products: [...websiteAnalysis.products, ...websiteAnalysis.services],
    activities: websiteAnalysis.activities,
    potentialHazards: websiteAnalysis.potentialHazards,
    industryKeywords: websiteAnalysis.industryKeywords,
    employeeCount,
    state,
    productCategory,
    supplyChainRole,
  };

  // === PROGRESSIVE DATABASE PERSISTENCE ===
  // Create company and empty discovery BEFORE starting analysis, so the
  // frontend can poll and see results as they arrive.

  const company = await createCompany({
    companyName: companyName || `Company (${productCategory})`,
    website: website || '',
    naicsCode: productCategory,
    employeeCount,
    state,
    contactEmail: email,
    websiteAnalysis: websiteAnalysis as unknown as Record<string, unknown>,
  });

  console.log(`[worker] Created company: ${company.id}`);

  // Auto-link: if a registered user has this email, link them to the company
  const existingUser = await findUserByEmail(email);
  if (existingUser && existingUser.companyId !== company.id) {
    await linkUserToCompany(existingUser.id, company.id);
    console.log(`[worker] Auto-linked user ${existingUser.id} to company ${company.id}`);
  }

  const discovery = await createEmptyDiscovery({
    companyId: company.id,
    agency: 'FDA',
    metadata: {
      productCategory,
      supplyChainRole,
      employeeCount,
      websiteAnalyzed: website || null,
      thresholdRequirements: thresholdResults.requirements,
      searchKeywords: additionalKeywords,
      status: 'in_progress',
    },
  });

  console.log(`[worker] Created empty discovery: ${discovery.id} (progressive loading enabled)`);

  // === ABORT SIGNAL SETUP ===
  const adminAbortController = activeDiscoveries.register(
    discovery.id,
    company.id,
    companyName || `Company (${productCategory})`,
    email
  );

  const combinedController = new AbortController();

  // Log client disconnect but do NOT abort the pipeline — discovery runs to
  // completion server-side regardless of client connection.
  clientSignal?.addEventListener('abort', () => {
    console.log(`[worker] Client disconnected for discovery ${discovery.id} — pipeline continues`);
  });

  adminAbortController.signal.addEventListener('abort', () => {
    console.log(`[worker] Admin cancelled discovery ${discovery.id}`);
    combinedController.abort();
  });

  try {
    const requirements = await recallDiscovery.discoverRecalls([productCategory], {
      maxResults,
      companyContext,
      signal: combinedController.signal,
      onProgress: async (requirement: DiscoveredRequirement, index: number, total: number) => {
        console.log(`[worker] Saving recall ${index + 1}/${total}: ${requirement.citation}`);
        await appendRequirement(discovery.id, requirement);
        activeDiscoveries.updateProgress(discovery.id, index + 1, total, requirement.citation);
      },
    });

    console.log(`[worker] Discovery complete: ${requirements.length} recalls saved progressively`);

    await updateDiscoveryStatus(discovery.id, 'complete');

    tokenTracker.log();

    return {
      success: true,
      naicsCode: productCategory,
      companyName,
      employeeCount,
      requirements,
      totalRequirements: requirements.length,
      companyIntelligence: {
        websiteAnalysis,
        thresholdRequirements: thresholdResults.requirements,
        thresholdSummary: {
          total: thresholdResults.summary.total,
          applicable: thresholdResults.summary.applicable,
          byAgency: thresholdResults.summary.byAgency,
        },
      },
      searchKeywords: additionalKeywords,
      discoveredAt: new Date().toISOString(),
      companyId: company.id,
      discoveryId: discovery.id,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      await updateDiscoveryStatus(discovery.id, 'cancelled');
      throw error;
    }
    console.error(`[worker] Error during discovery ${discovery.id}:`, error);
    throw error;
  } finally {
    activeDiscoveries.unregister(discovery.id);
  }
}
