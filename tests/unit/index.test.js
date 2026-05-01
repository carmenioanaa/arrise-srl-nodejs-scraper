import { jest } from '@jest/globals';

describe('index.js Component Tests', () => {
  let index;
  
  beforeAll(async () => {
    index = await import('../../index.js');
  });

  describe('transformJobsForSOLR', () => {
    it('should filter locations to only Romanian cities', () => {
      const payload = {
        jobs: [
          { url: 'https://test.com/1', title: 'Job 1', location: ['Romania'] },
          { url: 'https://test.com/2', title: 'Job 2', location: ['Bucharest'] },
          { url: 'https://test.com/3', title: 'Job 3', location: ['Bulgaria'] },
          { url: 'https://test.com/4', title: 'Job 4', location: ['Cluj-Napoca'] },
          { url: 'https://test.com/5', title: 'Job 5', location: [] }
        ]
      };
      
      const result = index.transformJobsForSOLR(payload);
      
      expect(result.jobs[0].location).toEqual(['România']);
      expect(result.jobs[1].location).toEqual(['Bucharest']);
      expect(result.jobs[2].location).toEqual(['România']);
      expect(result.jobs[3].location).toEqual(['Cluj-Napoca']);
      expect(result.jobs[4].location).toEqual(['România']);
    });

    it('should keep company uppercase', () => {
      const payload = {
        source: 'arrise.com',
        company: 'arrise services srl',
        cif: '40181178',
        jobs: [
          { url: 'https://test.com/1', title: 'Job 1', company: 'arrise services', cif: '40181178' }
        ]
      };
      
      const result = index.transformJobsForSOLR(payload);
      
      expect(result.company).toBe('ARRISE SERVICES SRL');
    });

    it('should normalize workmode values', () => {
      const payload = {
        jobs: [
          { url: 'https://test.com/1', title: 'Job 1', workmode: 'Remote' },
          { url: 'https://test.com/2', title: 'Job 2', workmode: 'ON-SITE' },
          { url: 'https://test.com/3', title: 'Job 3', workmode: 'Hybrid' }
        ]
      };
      
      const result = index.transformJobsForSOLR(payload);
      
      expect(result.jobs[0].workmode).toBe('remote');
      expect(result.jobs[1].workmode).toBe('on-site');
      expect(result.jobs[2].workmode).toBe('hybrid');
    });
  });

  describe('mapToJobModel', () => {
    it('should map raw job to job model format', () => {
      const rawJob = {
        url: 'https://careers.arrise.com/job/123',
        title: 'Senior Developer',
        location: ['Bucharest'],
        tags: ['Java', 'Spring'],
        workmode: 'hybrid'
      };
      
      const COMPANY_NAME = 'ARRISE SERVICES SRL';
      const COMPANY_CIF = '40181178';
      
      const result = index.mapToJobModel(rawJob, COMPANY_CIF, COMPANY_NAME);
      
      expect(result.url).toBe(rawJob.url);
      expect(result.title).toBe(rawJob.title);
      expect(result.company).toBe(COMPANY_NAME);
      expect(result.cif).toBe(COMPANY_CIF);
      expect(result.location).toEqual(rawJob.location);
      expect(result.tags).toEqual(rawJob.tags);
      expect(result.workmode).toBe(rawJob.workmode);
      expect(result.status).toBe('scraped');
      expect(result.date).toBeDefined();
    });

    it('should remove undefined fields', () => {
      const rawJob = {
        url: 'https://test.com/1',
        title: 'Job 1'
      };
      
      const result = index.mapToJobModel(rawJob, '40181178');
      
      expect(result.location).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.workmode).toBeUndefined();
    });
  });

  describe('parseApiJobs', () => {
    it('should parse ARRISE API response format', () => {
      const apiData = {
        data: {
          total: 100,
          jobs: [
            {
              uid: '123',
              name: 'Senior Developer',
              city: [{ name: 'Bucharest' }],
              country: [{ name: 'Romania' }],
              vacancy_type: 'Hybrid',
              skills: ['Java', 'Spring']
            }
          ]
        }
      };
      
      const result = index.parseApiJobs(apiData);
      
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe('Senior Developer');
      expect(result.jobs[0].location).toEqual(['Bucharest']);
      expect(result.jobs[0].workmode).toBe('hybrid');
    });
  });

  describe('URL Generation', () => {
    it('should use seo.url when available', () => {
      const apiData = {
        data: {
          total: 1,
          jobs: [
            {
              uid: 'blt123',
              name: 'Test Job',
              seo: { url: '/en/vacancy/test-job-blt123_en' },
              city: [{ name: 'Bucharest' }]
            }
          ]
        }
      };
      
      const result = index.parseApiJobs(apiData);
      
      expect(result.jobs[0].url).toBe('https://careers.arrise.com/en/vacancy/test-job-blt123_en');
    });

    it('should fallback to uid-based URL when no seo.url', () => {
      const apiData = {
        data: {
          total: 1,
          jobs: [
            {
              uid: 'blt456',
              name: 'Test Job',
              city: [{ name: 'Bucharest' }]
            }
          ]
        }
      };
      
      const result = index.parseApiJobs(apiData);
      
      expect(result.jobs[0].url).toBe('https://careers.arrise.com/en/vacancy/blt456_en');
    });
  });
});