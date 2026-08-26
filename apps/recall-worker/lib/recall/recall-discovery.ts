// Recall Discovery Service
// Uses openFDA + CPSC APIs + Opus reasoning model to discover relevant product recalls
// Replaces lib/ecfr/requirement-discovery.ts with recall-focused pipeline
//
// Architecture:
// 1. Map product categories to FDA/CPSC endpoints
// 2. Fetch raw recalls from openFDA and/or CPSC APIs
// 3. Opus analyzes and scores each recall for relevance to the company
// 4. Progressive save via onProgress callback

import { fdaClient, recallIdentifier } from '@recall/shared/recall/fda-client';
import type { FDARecallResult } from '@recall/shared/recall/fda-client';
import { cpscClient } from './cpsc-client.ts';
import type { CPSCRecallResult } from './cpsc-client.ts';
import { opusClient, sonnetClient } from '@recall/shared/ai/anthropic-client';

/**
 * Discovered recall — structured for DB compatibility with DiscoveredRequirement
 */
export interface DiscoveredRecall {
  id: string;
  name: string;
  citation: string;          // recall number (e.g., "FDA D-0123-2024")
  title: string;             // product name / recall reason
  agency: 'FDA' | 'CPSC';
  part: string;              // product category
  section?: string;
  excerpt: string;           // brief description
  fullText?: string;         // full recall details
  appliesTo: string;         // supply chain impact
  triggers: string[];        // affected product types
  confidence: number;        // 0-100 relevance score
  reasoning: string;         // AI reasoning
  regulationSummary?: {      // recall summary
    scope: string;
    whoItAppliesTo: string;
    keyRequirements: string[];  // action items
    exemptions: string[];
    thresholds: string[];
  };
  possibleObligations?: {
    description: string;
    frequency: string;
    condition: string;
    citationSubsection: string;
  }[];
  source: 'fda_api' | 'cpsc_api' | 'reasoning_model';
  discoveredAt: Date;
  // Recall-specific fields stored in summary
  severity?: 'Class I' | 'Class II' | 'Class III';
  recallStatus?: string;
  distributionPattern?: string;
}

// Type alias for DB compatibility with existing requirement-discovery pattern
export type DiscoveredRequirement = DiscoveredRecall;

/**
 * Company context from website analysis
 * Used to ground recall scoring in actual company activities
 */
export interface CompanyContext {
  companyName?: string;
  products: string[];
  activities: string[];
  potentialHazards: string[];
  industryKeywords: string[];
  employeeCount?: number;
  state?: string;
  productCategory?: string;
  supplyChainRole?: string;
}

/**
 * Categories that map to FDA-only, CPSC-only, or both
 */
const CATEGORY_API_MAP: Record<string, ('fda' | 'cpsc')[]> = {
  'Food & Beverages': ['fda'],
  'Drugs & Pharmaceuticals': ['fda'],
  'Medical Devices': ['fda'],
  'Cosmetics': ['fda'],
  'Consumer Electronics': ['cpsc'],
  'Children\'s Products': ['cpsc'],
  'Household Products': ['cpsc'],
  'Sporting Goods': ['cpsc'],
  'Automotive': ['cpsc'],
};

/**
 * Recall Discovery Service
 * Discovers relevant product recalls using openFDA + CPSC APIs and Opus reasoning model
 */
export class RecallDiscoveryService {
  /**
   * Convert an FDA recall result into a DiscoveredRecall
   */
  private convertFDAResult(result: FDARecallResult): DiscoveredRecall {
    // Falls back through every endpoint's identifier. Using only
    // recall_number || event_id produced `fda_undefined` for every device recall,
    // so they would all collapse onto a single id.
    const identifier = recallIdentifier(result) ?? `${result.recalling_firm ?? 'unknown'}-${(result.product_description ?? '').slice(0, 40)}`;
    const id = `fda_${identifier}`.replace(/[^a-z0-9_]/gi, '_');

    return {
      id,
      name: result.product_description?.substring(0, 120) || 'Unknown Product',
      citation: `FDA ${identifier}`,
      title: result.reason_for_recall?.substring(0, 200) || 'Recall',
      agency: 'FDA',
      part: result.product_type || 'Unknown',
      excerpt: [
        result.reason_for_recall,
        `Firm: ${result.recalling_firm}`,
        `Classification: ${result.classification}`,
        `Status: ${result.status}`,
      ].filter(Boolean).join('. '),
      fullText: [
        `Product: ${result.product_description}`,
        `Reason: ${result.reason_for_recall}`,
        `Firm: ${result.recalling_firm} (${result.city}, ${result.state})`,
        `Classification: ${result.classification}`,
        `Status: ${result.status}`,
        `Distribution: ${result.distribution_pattern}`,
        `Quantity: ${result.product_quantity}`,
        `Voluntary/Mandated: ${result.voluntary_mandated}`,
        `Report Date: ${result.report_date}`,
        `Initiation Date: ${result.recall_initiation_date}`,
        result.termination_date ? `Termination Date: ${result.termination_date}` : null,
      ].filter(Boolean).join('\n'),
      appliesTo: '',
      triggers: [],
      confidence: 0,
      reasoning: '',
      source: 'fda_api',
      discoveredAt: new Date(),
      severity: result.classification as DiscoveredRecall['severity'],
      recallStatus: result.status,
      distributionPattern: result.distribution_pattern,
    };
  }

  /**
   * Convert a CPSC recall result into a DiscoveredRecall
   */
  private convertCPSCResult(result: CPSCRecallResult): DiscoveredRecall {
    const id = `cpsc_${result.RecallNumber || result.RecallID}`.replace(/[^a-z0-9_]/gi, '_');

    const products = (result.Products || []).map(p => p.Name).join(', ');
    const hazards = (result.Hazards || []).map(h => h.Name).join(', ');
    const remedies = (result.Remedies || []).map(r => r.Name).join(', ');
    const manufacturers = (result.Manufacturers || []).map(m => m.Name).join(', ');
    const retailers = (result.Retailers || []).map(r => r.Name).join(', ');

    return {
      id,
      name: result.Title?.substring(0, 120) || 'Unknown Product',
      citation: `CPSC ${result.RecallNumber}`,
      title: result.Title || 'Consumer Product Recall',
      agency: 'CPSC',
      part: (result.Products?.[0]?.Type) || 'Consumer Product',
      excerpt: [
        result.Description,
        hazards ? `Hazards: ${hazards}` : null,
      ].filter(Boolean).join('. '),
      fullText: [
        `Title: ${result.Title}`,
        `Description: ${result.Description}`,
        `Products: ${products}`,
        `Hazards: ${hazards}`,
        `Remedies: ${remedies}`,
        `Manufacturers: ${manufacturers}`,
        retailers ? `Retailers: ${retailers}` : null,
        `Recall Date: ${result.RecallDate}`,
        `URL: ${result.URL}`,
      ].filter(Boolean).join('\n'),
      appliesTo: '',
      triggers: [],
      confidence: 0,
      reasoning: '',
      source: 'cpsc_api',
      discoveredAt: new Date(),
    };
  }

  /**
   * Determine which APIs to query for a given set of product categories
   */
  private resolveAPIs(productCategories: string[]): { queryFDA: boolean; queryCPSC: boolean } {
    let queryFDA = false;
    let queryCPSC = false;

    for (const category of productCategories) {
      const apis = CATEGORY_API_MAP[category];
      if (apis) {
        if (apis.includes('fda')) queryFDA = true;
        if (apis.includes('cpsc')) queryCPSC = true;
      } else {
        // Unknown category — query both
        queryFDA = true;
        queryCPSC = true;
      }
    }

    // If nothing matched, query both
    if (!queryFDA && !queryCPSC) {
      queryFDA = true;
      queryCPSC = true;
    }

    return { queryFDA, queryCPSC };
  }

  /**
   * Fetch raw recalls from FDA and/or CPSC based on product categories
   */
  private async fetchRawRecalls(
    productCategories: string[],
    companyContext?: CompanyContext
  ): Promise<DiscoveredRecall[]> {
    const { queryFDA, queryCPSC } = this.resolveAPIs(productCategories);
    const allRecalls: DiscoveredRecall[] = [];

    const promises: Promise<void>[] = [];

    if (queryFDA) {
      const fdaPromise = (async () => {
        try {
          // Search each relevant product category on FDA
          const fdaCategories = fdaClient.resolveCategories(
            companyContext?.productCategory || productCategories[0]
          );

          const results = await fdaClient.search({
            categories: fdaCategories,
            productDescription: companyContext?.products?.[0],
            state: companyContext?.state,
            limit: 20,
          });

          for (const result of results) {
            allRecalls.push(this.convertFDAResult(result));
          }

          console.log(`[RecallDiscovery] Fetched ${results.length} FDA recalls`);
        } catch (error) {
          console.error('[RecallDiscovery] FDA fetch error:', error);
        }
      })();
      promises.push(fdaPromise);
    }

    if (queryCPSC) {
      const cpscPromise = (async () => {
        try {
          // Search CPSC by industry keywords
          const keyword = companyContext?.industryKeywords?.[0] ||
            productCategories[0] || '';

          const results = await cpscClient.search({
            keyword: keyword.substring(0, 50),
          });

          // Limit to 30 results from CPSC
          for (const result of results.slice(0, 30)) {
            allRecalls.push(this.convertCPSCResult(result));
          }

          console.log(`[RecallDiscovery] Fetched ${Math.min(results.length, 30)} CPSC recalls`);
        } catch (error) {
          console.error('[RecallDiscovery] CPSC fetch error:', error);
        }
      })();
      promises.push(cpscPromise);
    }

    await Promise.all(promises);

    console.log(`[RecallDiscovery] Total raw recalls fetched: ${allRecalls.length}`);
    return allRecalls;
  }

  /**
   * Use Sonnet to quickly rank raw recalls by relevance, returning the top N
   */
  private async rankRecalls(
    recalls: DiscoveredRecall[],
    companyContext: CompanyContext | undefined,
    topN: number,
    signal?: AbortSignal
  ): Promise<DiscoveredRecall[]> {
    if (recalls.length <= topN) return recalls;

    console.log(`[RecallDiscovery] Using Sonnet to rank ${recalls.length} recalls down to top ${topN}`);

    const recallSummaries = recalls.map((r, i) => (
      `[${i}] ${r.citation} | ${r.name} | ${r.excerpt.substring(0, 150)}`
    )).join('\n');

    const companyInfo = companyContext ? `
COMPANY:
- Name: ${companyContext.companyName || 'Unknown'}
- Products: ${companyContext.products.slice(0, 10).join(', ')}
- Activities: ${companyContext.activities.join(', ')}
- Hazards: ${companyContext.potentialHazards.join(', ')}
- Supply Chain Role: ${companyContext.supplyChainRole || 'Unknown'}
- State: ${companyContext.state || 'Unknown'}` : '';

    const prompt = `You are a product safety analyst. Rank the following recalls by relevance to this company's supply chain.
${companyInfo}

RECALLS:
${recallSummaries}

Select the ${topN} most relevant recalls. Consider:
1. Product overlap with company's products/industry
2. Supply chain impact (manufacturer, distributor, retailer)
3. Severity (Class I > Class II > Class III)
4. Geographic relevance

Respond ONLY with JSON: { "selectedIndices": [0, 5, 12, ...] }
Select exactly ${topN} indices.`;

    try {
      const response = await sonnetClient.ask(prompt, {
        maxTokens: 1000,
        temperature: 0.1,
        signal,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const indices: number[] = parsed.selectedIndices || [];
        const selected = indices
          .filter(i => i >= 0 && i < recalls.length)
          .map(i => recalls[i]);

        if (selected.length > 0) {
          console.log(`[RecallDiscovery] Sonnet selected ${selected.length} top recalls`);
          return selected;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.warn('[RecallDiscovery] Ranking failed, using first N recalls');
    }

    // Fallback: return first topN
    return recalls.slice(0, topN);
  }

  /**
   * Analyze a single recall with Opus
   * Scores relevance, identifies supply chain impact, extracts action items
   */
  private async analyzeRecall(
    recall: DiscoveredRecall,
    companyContext: CompanyContext | undefined,
    signal?: AbortSignal
  ): Promise<DiscoveredRecall> {
    const recallText = recall.fullText || recall.excerpt;

    if (!recallText || recallText.length < 20) {
      recall.confidence = 0;
      recall.reasoning = 'Insufficient recall data for analysis';
      return recall;
    }

    const companyInfo = companyContext ? `
COMPANY INFORMATION:
- Company Name: ${companyContext.companyName || 'Unknown'}
- Products/Services: ${companyContext.products.join(', ')}
- Activities: ${companyContext.activities.join(', ')}
- Identified Hazards: ${companyContext.potentialHazards.join(', ')}
- Industry Keywords: ${companyContext.industryKeywords.join(', ')}
- Supply Chain Role: ${companyContext.supplyChainRole || 'Unknown'}
- Employee Count: ${companyContext.employeeCount || 'Unknown'}
- State: ${companyContext.state || 'Unknown'}` : '';

    try {
      // Single combined analysis call: understand + score + extract actions
      const analysisPrompt = `You are a product safety and recall compliance expert.

Analyze this recall and determine its relevance and impact on a specific company's supply chain.

RECALL DETAILS:
${recallText}
${companyInfo}

TASKS:
1. UNDERSTAND the recall: What product is affected? What is the hazard? Who is impacted?
2. SCORE relevance to this company (0-100):
   - 90-100: Company directly affected (their product, their supplier, their distributor)
   - 70-89: Company likely affected (same product category, similar supply chain)
   - 50-69: Company potentially affected (related industry, indirect exposure)
   - 30-49: Company has minor connection (awareness recommended)
   - 10-29: Low relevance but in same broad industry
   - 0-9: Not relevant to this company
3. IDENTIFY supply chain impact
4. EXTRACT action items (response procedures, customer notifications, inventory checks, etc.)
5. CLASSIFY severity based on the recall classification

Respond in JSON:
{
  "regulationSummary": {
    "scope": "What this recall covers",
    "whoItAppliesTo": "Who in the supply chain is affected",
    "keyRequirements": ["Action item 1", "Action item 2"],
    "exemptions": ["Who is NOT affected"],
    "thresholds": ["Quantity/geographic thresholds"]
  },
  "confidence": 0-100,
  "appliesTo": "Why this recall matters to this company",
  "triggers": ["Affected product type 1", "Affected product type 2"],
  "reasoning": "Step-by-step reasoning for the score",
  "possibleObligations": [
    {
      "description": "What must be done",
      "frequency": "Immediate / Ongoing / One-time",
      "condition": "Under what circumstances",
      "citationSubsection": "Recall reference"
    }
  ]
}`;

      const response = await opusClient.ask(analysisPrompt, {
        maxTokens: 3000,
        temperature: 0.1,
        signal,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        recall.regulationSummary = parsed.regulationSummary;
        recall.confidence = parsed.confidence ?? 0;
        recall.appliesTo = parsed.appliesTo || '';
        recall.triggers = parsed.triggers || [];
        recall.reasoning = parsed.reasoning || '';
        recall.possibleObligations = parsed.possibleObligations || [];
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.error(`[Opus] Error analyzing ${recall.citation}:`, error);
      recall.confidence = 0;
      recall.reasoning = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    return recall;
  }

  /**
   * Main discovery method: search APIs, rank, analyze, and score recalls
   *
   * @param productCategories - Product categories to search (e.g., ["Food & Beverages", "Medical Devices"])
   * @param options - Discovery options including company context, progress callback, and abort signal
   * @returns Array of discovered recalls, sorted by confidence score
   */
  async discoverRecalls(
    productCategories: string[],
    options?: {
      maxResults?: number;
      companyContext?: CompanyContext;
      onProgress?: (recall: DiscoveredRecall, index: number, total: number) => Promise<void>;
      signal?: AbortSignal;
    }
  ): Promise<DiscoveredRecall[]> {
    const maxResults = options?.maxResults || 20;
    const companyContext = options?.companyContext;
    const signal = options?.signal;

    // Check if already aborted
    if (signal?.aborted) {
      console.log('[RecallDiscovery] Aborted before starting');
      return [];
    }

    console.log(`[RecallDiscovery] Starting discovery for categories: ${productCategories.join(', ')}`);
    if (companyContext) {
      console.log(`[RecallDiscovery] Company: ${companyContext.companyName || 'unnamed'}`);
    }

    // Step 1: Fetch raw recalls from FDA and CPSC
    const rawRecalls = await this.fetchRawRecalls(productCategories, companyContext);

    if (rawRecalls.length === 0) {
      console.log('[RecallDiscovery] No raw recalls found');
      return [];
    }

    // Check if aborted after fetch
    if (signal?.aborted) {
      console.log('[RecallDiscovery] Aborted after API fetch');
      return [];
    }

    // Step 2: Use Sonnet to rank and select top candidates
    const topCandidates = await this.rankRecalls(
      rawRecalls,
      companyContext,
      maxResults,
      signal
    );

    // Check if aborted after ranking
    if (signal?.aborted) {
      console.log('[RecallDiscovery] Aborted after ranking');
      return [];
    }

    // Step 3: Analyze each top candidate with Opus (one at a time for quality)
    console.log(`[RecallDiscovery] Starting Opus analysis for ${topCandidates.length} recalls...`);

    const results: DiscoveredRecall[] = [];

    for (let i = 0; i < topCandidates.length; i++) {
      // Check if aborted before each analysis
      if (signal?.aborted) {
        console.log(`[RecallDiscovery] Aborted after ${i} recalls analyzed`);
        break;
      }

      const candidate = topCandidates[i];
      console.log(`[Opus] Analyzing recall ${i + 1}/${topCandidates.length}: ${candidate.citation}`);

      try {
        const analyzed = await this.analyzeRecall(candidate, companyContext, signal);
        results.push(analyzed);

        console.log(`[Opus] ${candidate.citation} -> ${analyzed.confidence}% confidence`);

        // Call progress callback for progressive saving
        if (options?.onProgress) {
          await options.onProgress(analyzed, i, topCandidates.length);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log(`[Opus] Aborted during recall ${i + 1}`);
          break;
        }
        console.error(`[Opus] Error analyzing ${candidate.citation}:`, error);
        // Continue with next recall on non-abort errors
      }
    }

    // Sort by confidence and return
    return results.sort((a, b) => b.confidence - a.confidence);
  }
}

// Export singleton instance
export const recallDiscovery = new RecallDiscoveryService();
