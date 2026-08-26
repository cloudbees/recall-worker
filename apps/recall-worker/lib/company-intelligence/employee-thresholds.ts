// Employee Threshold Service (Phase 1.3)
// Evaluates which regulatory requirements apply based on employee count
// These are federal statutory thresholds - not guesses

export interface ThresholdRequirement {
  name: string;
  regulation: string;       // CFR citation
  threshold: number;        // Employee count that triggers requirement
  applies: boolean;         // Does it apply to this company?
  description: string;
  agency: 'FDA' | 'CPSC' | 'OTHER';
  category: 'recordkeeping' | 'reporting' | 'program' | 'benefits' | 'notice';
}

// Federal employee-count thresholds
// Source: Actual CFR citations - these are statutory requirements
const FEDERAL_THRESHOLDS: Omit<ThresholdRequirement, 'applies'>[] = [
  // FDA Requirements
  {
    name: 'FDA Mandatory Recall Reporting',
    regulation: '21 CFR 7.40',
    threshold: 11,
    description: 'Must report product recalls to FDA within required timeframes',
    agency: 'FDA',
    category: 'reporting'
  },
  {
    name: 'FDA Adverse Event Reporting',
    regulation: '21 CFR 803',
    threshold: 11,
    description: 'Must report adverse events related to medical devices or drugs',
    agency: 'FDA',
    category: 'reporting'
  },
  {
    name: 'CPSC Section 15(b) Reporting',
    regulation: '16 CFR 1115',
    threshold: 1,
    description: 'Must report products that present substantial product hazards to CPSC',
    agency: 'CPSC',
    category: 'reporting'
  },
  {
    name: 'CPSC Full Compliance Program',
    regulation: '16 CFR 1115',
    threshold: 250,
    description: 'Must maintain comprehensive product safety compliance program',
    agency: 'CPSC',
    category: 'program'
  },

];

export class EmployeeThresholdService {
  /**
   * Evaluate which threshold-based requirements apply to a company
   */
  evaluateThresholds(employeeCount: number): ThresholdRequirement[] {
    return FEDERAL_THRESHOLDS.map(threshold => ({
      ...threshold,
      applies: employeeCount >= threshold.threshold
    }));
  }

  /**
   * Get only the requirements that apply to this company
   */
  getApplicableRequirements(employeeCount: number): ThresholdRequirement[] {
    return this.evaluateThresholds(employeeCount).filter(t => t.applies);
  }

  /**
   * Get requirements that are close to applying (within 20% of threshold)
   * Useful for growth planning
   */
  getUpcomingRequirements(employeeCount: number): ThresholdRequirement[] {
    const upcomingThreshold = employeeCount * 1.2; // 20% growth
    return FEDERAL_THRESHOLDS
      .filter(t => t.threshold > employeeCount && t.threshold <= upcomingThreshold)
      .map(t => ({ ...t, applies: false }));
  }

  /**
   * Get summary statistics
   */
  getSummary(employeeCount: number): {
    total: number;
    applicable: number;
    byAgency: Record<string, number>;
    byCategory: Record<string, number>;
  } {
    const evaluated = this.evaluateThresholds(employeeCount);
    const applicable = evaluated.filter(t => t.applies);

    const byAgency: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const req of applicable) {
      byAgency[req.agency] = (byAgency[req.agency] || 0) + 1;
      byCategory[req.category] = (byCategory[req.category] || 0) + 1;
    }

    return {
      total: evaluated.length,
      applicable: applicable.length,
      byAgency,
      byCategory
    };
  }
}

export const employeeThresholds = new EmployeeThresholdService();
