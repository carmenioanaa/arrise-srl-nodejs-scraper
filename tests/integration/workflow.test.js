import { jest } from '@jest/globals';

describe('Integration: API Workflow', () => {
  
  describe('Full company validation workflow', () => {
    it.skip('should go from brand to validated company (ANAF API can return 500)', async () => {
      const demoanaf = await import('../../demoanaf.js');
      const company = await import('../../company.js');
      const solr = await import('../../solr.js');
      
      const searchResults = await demoanaf.searchCompany('ARRISE');
      expect(searchResults.length).toBeGreaterThan(0);
      
      const arriseCompany = searchResults.find(c => 
        c.name.toUpperCase().includes('ARRISE') && c.statusLabel === 'Funcțiune'
      );
      expect(arriseCompany).toBeDefined();
      
      const anafData = await demoanaf.getCompanyFromANAF(arriseCompany.cui.toString());
      expect(anafData.name).toBe('ARRISE SERVICES S.R.L.');
      
      const companyResult = await company.validateAndGetCompany();
      expect(companyResult.status).toBe('active');
      expect(companyResult.cif).toBe('40181178');
      
      const solrResult = await solr.querySOLR(companyResult.cif);
      expect(solrResult.numFound).toBeGreaterThan(0);
    });
  });

  describe('Company data consistency', () => {
    it.skip('should have matching data across ANAF, Peviitor and SOLR (timeout issues)', async () => {
      const company = await import('../../company.js');
      const solr = await import('../../solr.js');
      
      const companyResult = await company.validateAndGetCompany();
      
      const solrResult = await solr.queryCompanySOLR(`company:${companyResult.company}*`);
      expect(solrResult.docs[0].brand).toBe('ARRISE');
    });
  });

  describe('Company Core Model Validation', () => {
    it('should have all required fields per company model', async () => {
      const solr = await import('../../solr.js');
      
      const result = await solr.queryCompanySOLR('id:40181178');
      expect(result.numFound).toBe(1);
      
      const arrise = result.docs[0];
      
      // Required: id, company
      expect(arrise.id).toBe('40181178');
      expect(arrise.company).toBeDefined();
      
      // All other model fields should exist per company-model.md
      expect(arrise.brand).toBe('ARRISE');
      expect(arrise.status).toBeDefined();
      expect(['activ','suspendat','inactiv','radiat']).toContain(arrise.status);
      expect(arrise.location).toBeDefined();
      expect(Array.isArray(arrise.location)).toBe(true);
      expect(arrise.lastScraped).toBeDefined();
      expect(arrise.scraperFile).toBeDefined();
    });
  });
});