// Web Scraping Service for Company Intelligence (Phase 1.3)
// Gathers data from company websites using Sonnet 4 analysis
// Employee count is now user-provided, not scraped

import type { CompanyProfile, CompanyLocation, DataSource } from './types.ts';
import { sonnetClient } from '@recall/shared/ai/anthropic-client';

export interface WebsiteAnalysisResult {
  products: string[];
  services: string[];
  activities: string[];           // Manufacturing, storage, shipping, etc.
  potentialHazards: string[];     // Chemicals, machinery, heights, etc.
  facilityTypes: string[];        // Warehouse, factory, office, lab, etc.
  certifications: string[];       // ISO 9001, etc.
  industryKeywords: string[];     // Additional keywords for CFR search
  confidence: number;
  rawExcerpt?: string;
}

export class WebScrapingService {
  private headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; Product-Recall-Tracker/1.0)',
    'Accept': 'text/html'
  };

  /**
   * Analyze company website for recall-relevant information
   * This is the main entry point for Phase 1.3
   */
  async scrapeCompanyWebsite(websiteUrl: string): Promise<WebsiteAnalysisResult> {
    try {
      if (!websiteUrl) {
        console.log('[WebScraper] No website URL provided');
        return this.emptyResult();
      }
      const url = this.normalizeUrl(websiteUrl);
      console.log(`[WebScraper] Analyzing website: ${url}`);

      // Fetch website content
      const content = await this.fetchWebsiteContent(url);

      if (!content) {
        console.log('[WebScraper] Could not fetch website content');
        return this.emptyResult();
      }

      // Use LLM to analyze the content
      const analysis = await this.analyzeWithLLM(content, url);
      return analysis;
    } catch (error) {
      console.error('[WebScraper] Website analysis error:', error);
      return this.emptyResult();
    }
  }

  /**
   * Fetch website content (homepage)
   */
  private async fetchWebsiteContent(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(15000) // 15 second timeout
      });

      if (!response.ok) {
        console.log(`[WebScraper] Website returned ${response.status}`);
        return null;
      }

      const html = await response.text();

      // Extract text content
      const textContent = this.extractTextFromHtml(html);

      // Limit content size for LLM
      return textContent.slice(0, 15000);
    } catch (error) {
      console.error('[WebScraper] Fetch error:', error);
      return null;
    }
  }

  /**
   * Extract readable text from HTML
   */
  private extractTextFromHtml(html: string): string {
    // Remove script and style tags
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

    // Remove HTML tags but keep content
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, "'")
      .replace(/&lsquo;/g, "'")
      .replace(/&rdquo;/g, '"')
      .replace(/&ldquo;/g, '"')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–');

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Use LLM to analyze website content for recall-relevant information
   */
  private async analyzeWithLLM(content: string, websiteUrl: string): Promise<WebsiteAnalysisResult> {
    const prompt = `You are a product safety and supply chain expert.

Analyze this company website content to identify products, supply chain information, and recall risk factors.

Website: ${websiteUrl}
Content:
${content.slice(0, 12000)}

Extract the following information for product recall tracking purposes:

1. **Products**: What products does this company make or sell? Be specific.
2. **Services**: What services do they provide?
3. **Activities**: What supply chain activities are involved? (manufacturing, importing, distributing, retailing, packaging, assembly, etc.)
4. **Potential Recall Risks**: Based on their products, what recall risks might exist? (contamination, defect, mislabeling, choking hazard, electrical, fire, etc.)
5. **Facility Types**: What types of facilities do they likely operate? (factory, warehouse, office, laboratory, retail, etc.)
6. **Certifications**: Any certifications mentioned (ISO 9001, ISO 14001, OHSAS 18001, etc.)
7. **Industry Keywords**: What specific terms should we search for in FDA/CPSC recall databases? Focus on product names, ingredients, materials, components.

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "products": ["product1", "product2"],
  "services": ["service1", "service2"],
  "activities": ["manufacturing", "importing"],
  "potentialHazards": ["contamination", "defect"],
  "facilityTypes": ["factory", "warehouse"],
  "certifications": ["ISO 9001"],
  "industryKeywords": ["children's toys", "lithium battery", "food contact"],
  "confidence": 75
}

Be specific and thorough. The keywords will be used to search FDA and CPSC recall databases.
If you cannot determine something, use an empty array. Set confidence 0-100 based on how much relevant information you found.`;

    console.log('[WebScraper] Using Sonnet 4 for website analysis');
    const response = await sonnetClient.ask(prompt, {
      maxTokens: 2000,
      temperature: 0.2
    });

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          products: parsed.products || [],
          services: parsed.services || [],
          activities: parsed.activities || [],
          potentialHazards: parsed.potentialHazards || [],
          facilityTypes: parsed.facilityTypes || [],
          certifications: parsed.certifications || [],
          industryKeywords: parsed.industryKeywords || [],
          confidence: parsed.confidence || 50,
          rawExcerpt: content.slice(0, 500)
        };
      }
    } catch (error) {
      console.error('[WebScraper] LLM parse error:', error);
    }

    return this.emptyResult();
  }

  /**
   * Return empty analysis result
   */
  private emptyResult(): WebsiteAnalysisResult {
    return {
      products: [],
      services: [],
      activities: [],
      potentialHazards: [],
      facilityTypes: [],
      certifications: [],
      industryKeywords: [],
      confidence: 0
    };
  }

  /**
   * DEPRECATED: Employee count now comes from user input
   * This method is kept for backwards compatibility but returns empty data
   */
  async analyzeCompanyWithLLM(companyName: string, isPublic?: boolean): Promise<Partial<CompanyProfile>> {
    console.log(`[WebScraper] analyzeCompanyWithLLM called for ${companyName} - employee count should come from user input`);
    return {};
  }

  /**
   * Extract company locations from website or public sources
   * NOTE: Basic implementation - could be enhanced
   */
  async findCompanyLocations(
    companyName: string,
    primaryState: string
  ): Promise<CompanyLocation[]> {
    // For now, return primary state as the main location
    // This could be enhanced to parse "Contact Us" or "Locations" pages
    return [{
      address: '',
      city: '',
      state: primaryState,
      type: 'HQ'
    }];
  }

  /**
   * Search news and press releases for company info
   * NOTE: Stub - would need news API integration
   */
  async searchNewsAndPress(companyName: string): Promise<{
    customerTypes: string[];
    annualRevenue?: string;
    parentCompany?: string;
  }> {
    return {
      customerTypes: [],
      annualRevenue: undefined,
      parentCompany: undefined
    };
  }

  // Helper methods

  private normalizeUrl(url: string): string {
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }
    return url.replace(/\/$/, '');
  }

  /**
   * Create data source tracking
   */
  createDataSource(
    source: 'LinkedIn' | 'Company Website' | 'Google' | 'News',
    dataPoints: string[]
  ): DataSource {
    return {
      source,
      dataPoints,
      fetchDate: new Date(),
      reliability: source === 'Company Website' ? 'high' : 'medium'
    };
  }
}

export const webScrapingService = new WebScrapingService();
