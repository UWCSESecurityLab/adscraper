// Type definitions for the rows of the input CSV files (sites to crawl).
export interface SeedSite {
  url: string,
  label?: string,
  dataset: string,
  warming_crawl: boolean
}

export interface SeedSiteCSVRow {
  url: string,
  label?: string
}