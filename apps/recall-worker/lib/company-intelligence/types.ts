// Company Intelligence Types for Phase 1
// Gathering comprehensive company data for compliance analysis

export interface CompanyInput {
  // Required inputs from user
  companyName: string;
  naicsCode: string;      // 6-digit NAICS
  state: string;          // Primary state of operation
  website: string;        // Company website URL
}

export interface CompanyLocation {
  address: string;
  city: string;
  state: string;
  type: 'HQ' | 'Manufacturing' | 'Office' | 'Warehouse';
  employeeCount?: number;
}

export interface CompanyProfile {
  // Basic Information
  companyName: string;
  naicsCode: string;
  website: string;
  primaryState: string;
  
  // Discovered from LinkedIn/Web
  employeeCount: number;
  employeeRange: string;        // "51-200 employees"
  locations: CompanyLocation[];
  
  // From Company Website Analysis
  products: string[];
  services: string[];
  industries: string[];          // Industries they serve
  certifications: string[];      // ISO 9001, ISO 13485, etc.
  
  // Business Context
  customerTypes: string[];
  annualRevenue?: string;
  parentCompany?: string;
  yearEstablished?: number;
  
  // Inferred from NAICS + Products
  likelyChemicals: string[];
  likelyProcesses: string[];
  likelyHazards: string[];
  
}

export interface RegulatoryThresholds {
  // Employee-based thresholds - dynamically populated by reasoning model
  employeeThresholds: {
    count: number;
    // Triggers will be discovered dynamically from FDA/CPSC
    // e.g., { "FDA Mandatory Reporting": true, "CPSC Section 15(b)": true }
    triggers: Record<string, boolean>;
  };

  // Other triggers - dynamically determined
  federalContractor: boolean;
  stateSpecificTriggers: Record<string, boolean>;
}

export interface DataQuality {
  // Track confidence in discovered data
  confidence: {
    employeeCount: 'verified' | 'estimated' | 'range';
    locations: 'complete' | 'partial' | 'primary-only';
    products: 'comprehensive' | 'sampling' | 'basic';
    epaData: 'found' | 'not-found' | 'partial';
  };
  
  // Data sources and freshness
  sources: DataSource[];
  
  // Overall quality score
  qualityScore: number; // 0-100
  lastUpdated: Date;
}

export interface DataSource {
  source: 'SEC Filings' | 'Public Records' | 'Company Website' | 'Google' | 'News' | 'LinkedIn';
  dataPoints: string[];
  fetchDate: Date;
  reliability: 'high' | 'medium' | 'low';
  rawData?: any;  // Store raw response for audit trail
}

export interface CompanyIntelligence {
  input: CompanyInput;
  profile: CompanyProfile;
  thresholds: RegulatoryThresholds;
  dataQuality: DataQuality;
  analysisDate: Date;
  
  // Recommendations based on intelligence
  recommendations: {
    criticalCompliance: string[];  // Must-have requirements
    likelyRequirements: string[];  // Probably applies
    investigateFurther: string[];  // Need more info
  };
}

// Error handling
export interface IntelligenceError {
  code: 'COMPANY_NOT_FOUND' | 'WEBSITE_UNREACHABLE' | 'LINKEDIN_BLOCKED';
  message: string;
  source: string;
  timestamp: Date;
}

// Cache structure for company data
export interface CachedCompanyData {
  companyName: string;
  intelligence: CompanyIntelligence;
  cacheDate: Date;
  ttl: number; // Time to live in seconds
}