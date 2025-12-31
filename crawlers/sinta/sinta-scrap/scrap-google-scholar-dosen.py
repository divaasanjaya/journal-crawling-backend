

import requests
from bs4 import BeautifulSoup
import time
from pymongo import MongoClient
import sys
import random

# --- CONFIG ---
BASE = "https://sinta.kemdiktisaintek.go.id"
AFFIL_AUTHORS_URL = f"{BASE}/affiliations/authors/1093"
MONGO_URI = 'mongodb://localhost:27017/'  # Ganti jika perlu
DB_NAME = 'journal_crawling'  # Ganti jika perlu
COLLECTION_NAME = 'dosen'

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
col_journals = db[COLLECTION_NAME]

def safe_request(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)  # Exponential backoff with jitter
                print(f"Request failed (attempt {attempt + 1}/{max_retries}): {e}. Retrying in {wait_time:.2f} seconds...")
                time.sleep(wait_time)
            else:
                raise e

def upsert_dosen(dosen):
        # Cek duplikasi berdasarkan SINTA ID
        query = {
            "sinta_id": dosen["sinta_id"]
        }
        existing = col_journals.find_one(query)
        if not existing:
            col_journals.insert_one(dosen)
            print(f"INSERTED: {dosen['nama']}")
        else:
            # Update jika ada perubahan
            col_journals.update_one(query, {"$set": dosen})
            print(f"UPDATED: {dosen['nama']}")


def get_all_author_urls(page_start=1, page_end=1):
    author_urls = set()
    for page in range(page_start, page_end + 1):
        url = f"{AFFIL_AUTHORS_URL}?page={page}"
        try:
            res = safe_request(url)
            soup = BeautifulSoup(res.text, "html.parser")
            links = soup.select('.au-item .profile-name a[href^="/authors/profile/"], .au-item .profile-name a[href^="https://sinta.kemdiktisaintek.go.id/authors/profile/"]')
            if not links:
                print(f"Page {page}: Tidak ada author ditemukan.")
                continue
            for a in links:
                href = a["href"]
                if not href.startswith("http"):
                    href = BASE + href
                author_urls.add(href)
            print(f"Page {page}: {len(links)} authors found")
        except requests.exceptions.RequestException as e:
            print(f"Failed to fetch page {page}: {e}")
        time.sleep(random.uniform(2, 5))  # Random delay between 2-5 seconds
    return list(author_urls)

def main():
    # STEP 1: ambil semua author dari afiliasi Telkom University (dengan paginasi)
    # Contoh: ambil author dari page 1 sampai 5
    if len(sys.argv) >= 3:
        page_start = int(sys.argv[1])
        page_end = int(sys.argv[2])
    else:
        page_start = 26
        page_end = 35
    author_urls = get_all_author_urls(page_start, page_end)
    print(f"Total author dari page {page_start} sampai {page_end}: {len(author_urls)}")

    # STEP 2: ambil data dosen
    dosen_list = []
    for url in author_urls:
        dosen_url = url
        print("Fetching:", dosen_url)
        try:
            r = safe_request(dosen_url)
            s = BeautifulSoup(r.text, "html.parser")

            # Extract nama
            nama_tag = s.select_one("h3 a")
            nama = nama_tag.text.strip() if nama_tag else ""

            # Extract affiliation
            affil_tag = s.select_one('.meta-profile a[href*="affiliations/profile"]')
            affiliation = affil_tag.text.strip() if affil_tag else ""

            # Extract department
            dept_tag = s.select_one('.meta-profile a[href*="departments/profile"]')
            department = dept_tag.text.strip() if dept_tag else ""

            # Extract SINTA ID
            sinta_id_tag = s.select_one('.meta-profile a[href="#!"]')
            sinta_id = ""
            if sinta_id_tag and "SINTA ID" in sinta_id_tag.text:
                sinta_id = sinta_id_tag.text.replace("SINTA ID :", "").strip()

            # Extract stats from table
            stats = {}
            table = s.select_one('.stat-table tbody')
            if table:
                rows = table.find_all('tr')
                for row in rows:
                    cols = row.find_all('td')
                    if len(cols) >= 4:
                        metric = cols[0].text.strip()
                        scopus = cols[1].text.strip()
                        gscholar = cols[2].text.strip()
                        wos = cols[3].text.strip() if len(cols) > 3 else ""

                        if metric == "Article":
                            stats['article_scopus'] = int(scopus) if scopus.isdigit() else 0
                            stats['article_gscholar'] = int(gscholar) if gscholar.isdigit() else 0
                            stats['article_wos'] = int(wos) if wos.isdigit() else 0
                        elif metric == "Citation":
                            stats['citation_scopus'] = int(scopus) if scopus.isdigit() else 0
                            stats['citation_gscholar'] = int(gscholar) if gscholar.isdigit() else 0
                            stats['citation_wos'] = int(wos) if wos.isdigit() else 0
                        elif metric == "H-Index":
                            stats['hindex_scopus'] = int(scopus) if scopus.isdigit() else 0
                            stats['hindex_gscholar'] = int(gscholar) if gscholar.isdigit() else 0
                            stats['hindex_wos'] = int(wos) if wos.isdigit() else 0

            dosen_data = {
                "nama": nama,
                "affiliation": affiliation,
                "department": department,
                "sinta_id": sinta_id,
                "article_scopus": stats.get('article_scopus', 0),
                "article_gscholar": stats.get('article_gscholar', 0),
                "article_wos": stats.get('article_wos', 0),
                "citation_scopus": stats.get('citation_scopus', 0),
                "citation_gscholar": stats.get('citation_gscholar', 0),
                "citation_wos": stats.get('citation_wos', 0),
                "hindex_scopus": stats.get('hindex_scopus', 0),
                "hindex_gscholar": stats.get('hindex_gscholar', 0),
                "hindex_wos": stats.get('hindex_wos', 0)
            }

            print(dosen_data)
            upsert_dosen(dosen_data)
            dosen_list.append(dosen_data)

        except requests.exceptions.RequestException as e:
            print(f"Failed to fetch {dosen_url}: {e}")

        time.sleep(random.uniform(3, 6))  # Random delay to avoid blocking

    print(f"Dosen diproses: {len(dosen_list)}")

if __name__ == "__main__":
    main()
