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

  describe('parseJobsFromHtml', () => {
    it('should parse job links from ARRISE HTML page', () => {
      const html = `
        <html>
          <body>
            <a href="/careers/job/game-presenter-1234"><h3>Game Presenter</h3></a>
            <a href="/careers/job/customer-support-5678"><h4>Customer Support</h4></a>
            <a href="/other/page">Other Link</a>
          </body>
        </html>
      `;
      
      const result = index.parseJobsFromHtml(html);
      
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Game Presenter');
      expect(result[0].url).toBe('https://arrise.com/careers/job/game-presenter-1234');
      expect(result[0].uid).toBe('game-presenter-1234');
      expect(result[1].title).toBe('Customer Support');
      expect(result[1].url).toBe('https://arrise.com/careers/job/customer-support-5678');
    });

    it('should handle absolute URLs in href', () => {
      const html = `
        <html>
          <body>
            <a href="https://arrise.com/careers/job/full-url-9999"><h3>Full URL Job</h3></a>
            <a href="/careers/job/relative-url-8888"><h3>Relative URL Job</h3></a>
          </body>
        </html>
      `;
      
      const result = index.parseJobsFromHtml(html);
      
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://arrise.com/careers/job/full-url-9999');
      expect(result[1].url).toBe('https://arrise.com/careers/job/relative-url-8888');
    });

    it('should skip links with short or empty titles', () => {
      const html = `
        <html>
          <body>
            <a href="/careers/job/short-title"><h3>Hi</h3></a>
            <a href="/careers/job/empty-title"><h3></h3></a>
            <a href="/careers/job/valid-job"><h3>Valid Job Title</h3></a>
          </body>
        </html>
      `;
      
      const result = index.parseJobsFromHtml(html);
      
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Valid Job Title');
    });
  });
});