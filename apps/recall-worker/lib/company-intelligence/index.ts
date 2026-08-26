// Company Intelligence Service - Main Export
// Phase 1: Comprehensive company data gathering for compliance analysis
// All threshold detection will be done dynamically via reasoning model + FDA/CPSC API

export * from './types.ts';
export { companyAnalyzer } from './company-analyzer.ts';
export { webScrapingService } from './web-scraper.ts';


// Re-export main function for easy use
import { companyAnalyzer } from './company-analyzer.ts';
import type { CompanyInput, CompanyIntelligence } from './types.ts';

/**
 * Main entry point for company intelligence gathering
 *
 * @param input - Company information (name, NAICS, state, website)
 * @returns Complete company intelligence with profile, thresholds, and recommendations
 */
export async function gatherCompanyIntelligence(
  input: CompanyInput
): Promise<CompanyIntelligence> {
  // Check cache first
  const cached = await companyAnalyzer.getCachedAnalysis(input.companyName);
  if (cached) {
    console.log('Returning cached company intelligence');
    return cached;
  }

  // Perform new analysis
  const intelligence = await companyAnalyzer.analyzeCompany(input);

  // Cache for future use
  await companyAnalyzer.cacheAnalysis(intelligence);

  return intelligence;
}