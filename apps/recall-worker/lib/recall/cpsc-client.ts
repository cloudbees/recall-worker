// CPSC (Consumer Product Safety Commission) API Client
// Connects to the SaferProducts.gov REST API for consumer product recall data
// Documentation: https://www.saferproducts.gov/RestWebServices
// Free API, no authentication required

export interface CPSCProduct {
  Name: string;
  Description: string;
  Type: string;
}

export interface CPSCHazard {
  Name: string;
  HazardType: string;
  HazardTypeID?: number;
}

export interface CPSCRemedy {
  Name: string;
  Description?: string;
}

export interface CPSCManufacturer {
  Name: string;
  CompanyID?: string;
}

export interface CPSCRetailer {
  Name: string;
  CompanyID?: string;
}

export interface CPSCRecallResult {
  RecallID: number;
  RecallNumber: string;
  RecallDate: string;
  Description: string;
  URL: string;
  Title: string;
  ConsumerContact: string;
  LastPublishDate: string;
  Products: CPSCProduct[];
  Hazards: CPSCHazard[];
  Remedies: CPSCRemedy[];
  Manufacturers: CPSCManufacturer[];
  Retailers: CPSCRetailer[];
  Inconjunctions: unknown[];
  Images: { URL: string }[];
}

export interface CPSCSearchOptions {
  keyword?: string;
  productType?: string;
  startDate?: string;  // YYYY-MM-DD
  endDate?: string;    // YYYY-MM-DD
  recallNumber?: string;
  recallTitle?: string;
}

const CPSC_BASE_URL = 'https://www.saferproducts.gov/RestWebServices/Recall';

/**
 * CPSC SaferProducts.gov API Client for consumer product recall data
 */
export class CPSCClient {
  /**
   * Build the query URL for the CPSC API
   * The API uses query parameters: format=json, RecallTitle, RecallDateStart, RecallDateEnd, etc.
   */
  private buildUrl(options: CPSCSearchOptions): string {
    const params = new URLSearchParams({
      format: 'json',
    });

    if (options.keyword) {
      // CPSC API searches by RecallTitle or product name
      params.set('RecallTitle', options.keyword);
    }

    if (options.recallNumber) {
      params.set('RecallNumber', options.recallNumber);
    }

    if (options.recallTitle) {
      params.set('RecallTitle', options.recallTitle);
    }

    if (options.startDate) {
      params.set('RecallDateStart', options.startDate);
    }

    if (options.endDate) {
      params.set('RecallDateEnd', options.endDate);
    }

    return `${CPSC_BASE_URL}?${params.toString()}`;
  }

  /**
   * Search for CPSC recalls
   * Returns consumer product recall data from SaferProducts.gov
   */
  async search(options: CPSCSearchOptions = {}): Promise<CPSCRecallResult[]> {
    const url = this.buildUrl(options);
    console.log(`[CPSC] Searching: ${url}`);

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      if (!response.ok) {
        console.warn(`[CPSC] Search failed: ${response.status}`);
        return [];
      }

      // Cast required: under the Node lib, Response.json() resolves to `unknown`.
      const data = (await response.json()) as CPSCRecallResult[];

      // Filter by product type if specified (client-side filter since API doesn't support it natively)
      let results = data || [];
      if (options.productType) {
        const typeFilter = options.productType.toLowerCase();
        results = results.filter(recall =>
          recall.Products?.some(
            p =>
              p.Type?.toLowerCase().includes(typeFilter) ||
              p.Name?.toLowerCase().includes(typeFilter) ||
              p.Description?.toLowerCase().includes(typeFilter)
          )
        );
      }

      console.log(`[CPSC] Found ${results.length} results`);
      return results;
    } catch (error) {
      console.error(`[CPSC] Error searching recalls:`, error);
      return [];
    }
  }

  /**
   * Search by keyword (convenience method)
   */
  async searchByKeyword(keyword: string): Promise<CPSCRecallResult[]> {
    return this.search({ keyword });
  }

  /**
   * Search by date range (convenience method)
   */
  async searchByDateRange(
    startDate: string,
    endDate: string
  ): Promise<CPSCRecallResult[]> {
    return this.search({ startDate, endDate });
  }

  /**
   * Get recent recalls (last 30 days)
   */
  async getRecentRecalls(): Promise<CPSCRecallResult[]> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    return this.search({ startDate, endDate });
  }
}

// Export singleton instance
export const cpscClient = new CPSCClient();
