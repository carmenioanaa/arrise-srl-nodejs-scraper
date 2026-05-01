import { jest } from '@jest/globals';

const HAS_SOLR_AUTH = !!process.env.SOLR_AUTH;

describe('solr.js', () => {
  let solr;

  beforeAll(async () => {
    solr = await import('../../solr.js');
  });

  describe('querySOLR', () => {
    it('should return response object with docs', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await solr.querySOLR('40181178');

      expect(result).toHaveProperty('numFound');
      expect(result).toHaveProperty('docs');
      expect(Array.isArray(result.docs)).toBe(true);
    });

    it('should return jobs for specific CIF', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await solr.querySOLR('40181178');

      expect(result.numFound).toBeGreaterThan(0);
      expect(result.docs[0]).toHaveProperty('cif', '40181178');
    });
  });

  describe('queryCompanySOLR', () => {
    it('should return company data', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await solr.queryCompanySOLR('company:ARRISE*');

      expect(result).toHaveProperty('numFound');
      if (result.numFound > 0) {
        expect(result.docs[0]).toHaveProperty('brand', 'ARRISE');
      }
    });
  });

  describe('upsertJobs', () => {
    it.skip('should accept array of jobs', async () => {
      const testJob = {
        url: 'https://test.com/job1',
        title: 'Test Job',
        company: 'TEST COMPANY',
        cif: '12345678',
        status: 'scraped'
      };

      await expect(solr.upsertJobs([testJob])).resolves.not.toThrow();
    });
  });

  describe('getSolrAuth', () => {
    it('should return SOLR_AUTH from environment', () => {
      const auth = solr.getSolrAuth();

      expect(auth).toBeDefined();
      expect(typeof auth).toBe('string');
    });
  });

  describe('Data Integrity', () => {
    it('should not have duplicate URLs for same CIF', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await solr.querySOLR('40181178');

      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);

      expect(uniqueUrls.size).toBe(result.numFound);
    });

    it('should have valid CIF format for all jobs', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await solr.querySOLR('40181178');

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{8}$/);
      }
    });

    it('should have valid status values', async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await solr.querySOLR('40181178');
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    });
  });

  describe('Company Core Validation', () => {
    let arrise = null;

    beforeAll(async () => {
      if (!HAS_SOLR_AUTH) return;
      const result = await solr.queryCompanySOLR('id:40181178');
      if (result.numFound > 0) {
        arrise = result.docs[0];
      }
    });

    it('should have all required fields for ARRISE in company core', async () => {
      if (!arrise) return;

      expect(arrise).toHaveProperty('id', '40181178');
      expect(arrise).toHaveProperty('company');
      expect(arrise.company).toBe('ARRISE SERVICES S.R.L.');

      expect(arrise).toHaveProperty('brand', 'ARRISE');
      expect(arrise).toHaveProperty('status', 'activ');
      expect(arrise).toHaveProperty('location');
      expect(Array.isArray(arrise.location)).toBe(true);
      expect(arrise.location).toContain('Bucuresti');
      expect(arrise).toHaveProperty('lastScraped');
      expect(arrise.lastScraped).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(arrise).toHaveProperty('scraperFile');
      expect(arrise.scraperFile).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
    });

    it('should have optional fields for ARRISE in company core', async () => {
      if (!arrise) return;

      if (arrise.group) expect(typeof arrise.group).toBe('string');
    });

    it('should have website field with valid URL for ARRISE', async () => {
      if (!arrise) return;

      expect(arrise).toHaveProperty('website');
      expect(Array.isArray(arrise.website)).toBe(true);
      expect(arrise.website.length).toBeGreaterThan(0);
      expect(arrise.website[0]).toMatch(/^https?:\/\/.+/);
    });

    it('should have career field with valid URL for ARRISE', async () => {
      if (!arrise) return;

      expect(arrise).toHaveProperty('career');
      expect(Array.isArray(arrise.career)).toBe(true);
      expect(arrise.career.length).toBeGreaterThan(0);
      expect(arrise.career[0]).toMatch(/^https?:\/\/.+/);
    });
  });
});
