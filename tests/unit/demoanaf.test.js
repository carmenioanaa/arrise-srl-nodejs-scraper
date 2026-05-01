import { jest } from '@jest/globals';

const CACHED_ANAF_DATA = {
  cui: 40181178,
  name: "ARRISE SERVICES S.R.L.",
  address: "MUNICIPIUL BUCUREŞTI, SECTOR 1, STR. ALEXANDRU CONSTANTINESCU, NR. 5, CLADIREA L, ETAJ 1",
  registrationNumber: "J2018016640406",
  phone: "",
  fax: "",
  postalCode: "11745",
  caenCode: "6220",
  iban: "",
  registrationState: "INREGISTRARE din data 2018-12-21",
  registrationDate: "2018-12-21",
  fiscalAuthority: "Direcţia Generală a Finanţelor Publice Municipiul Bucureşti",
  ownershipForm: "PROPR.PRIVATA-CAPITAL PRIVAT STRAIN",
  organizationForm: "PERSOANA JURIDICA",
  legalForm: "SOCIETATE COMERCIALĂ CU RĂSPUNDERE LIMITATĂ",
  vatRegistered: true,
  cashBasisVat: false,
  cashBasisVatStart: null,
  cashBasisVatEnd: null,
  inactive: false,
  inactiveSince: null,
  reactivatedSince: null,
  splitVat: false,
  eFacturaRegistered: false,
  headquartersAddress: {
    street: "Str. Alexandru Constantinescu",
    number: "5",
    locality: "Sector 1 Mun. Bucureşti",
    county: "MUNICIPIUL BUCUREŞTI",
    country: "",
    postalCode: "11745"
  },
  fiscalAddress: {
    street: "",
    number: "",
    locality: "",
    county: "",
    country: "",
    postalCode: ""
  },
  administrators: [
    {
      name: "DANIEL RASMUSSEN",
      role: "administrator"
    }
  ],
  authorizedCaenCodes: ["6210", "6220", "6290", "7020", "8559"],
  onrcStatus: 1048,
  onrcStatusLabel: "Funcțiune"
};

describe('demoanaf.js', () => {
  let demoanaf;
  
  beforeAll(async () => {
    demoanaf = await import('../../demoanaf.js');
  });

  describe('searchCompany', () => {
    it('should return array of companies for valid brand', async () => {
      const results = await demoanaf.searchCompany('ARRISE');
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('cui');
      expect(results[0]).toHaveProperty('name');
    });

    it('should return empty array for non-existent brand', async () => {
      const results = await demoanaf.searchCompany('NonExistentBrandXYZ123');
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should include statusLabel in results', async () => {
      const results = await demoanaf.searchCompany('ARRISE');
      
      expect(results[0]).toHaveProperty('statusLabel');
    });
  });

  describe('getCompanyFromANAF', () => {
    it('should return company data for valid CIF with fallback', async () => {
      const data = await demoanaf.getCompanyFromANAFWithFallback('40181178', CACHED_ANAF_DATA);
      
      expect(data).toBeDefined();
      expect(data.cui).toBe(40181178);
      expect(data.name).toBe('ARRISE SERVICES S.R.L.');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
    }, 120000);

    it.skip('should throw error for invalid CIF (requires live ANAF API)', async () => {
      await expect(demoanaf.getCompanyFromANAF('99999999')).rejects.toThrow();
    }, 120000);
  });
});