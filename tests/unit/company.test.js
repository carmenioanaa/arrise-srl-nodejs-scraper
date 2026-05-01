import { jest } from '@jest/globals';

const HAS_SOLR_AUTH = !!process.env.SOLR_AUTH;

describe('company.js', () => {
  let company;
  
  beforeAll(async () => {
    company = await import('../../company.js');
  });

  describe('getCompanyBrand', () => {
    it('should return the company brand', () => {
      const brand = company.getCompanyBrand();
      
      expect(typeof brand).toBe('string');
      expect(brand).toBe('ARRISE');
    });
  });

  describe('validateAndGetCompany', () => {
    it('should return company data with status active', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await company.validateAndGetCompany();
      
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('company');
      expect(result).toHaveProperty('cif');
      expect(result.status).toBe('active');
      expect(result.cif).toBe('40181178');
    });

    it('should include existingJobsCount', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await company.validateAndGetCompany();
      
      expect(result).toHaveProperty('existingJobsCount');
      expect(typeof result.existingJobsCount).toBe('number');
    });
  });
});