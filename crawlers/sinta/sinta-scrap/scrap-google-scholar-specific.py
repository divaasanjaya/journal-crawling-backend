

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
COLLECTION_NAME = 'journal'

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

def upsert_journal(journal):
        # Cek duplikasi berdasarkan title, doi, dan authors
        query = {
            "title": journal["title"],
            "doi": journal.get("doi", ""),
            "authors": journal.get("authors", [])
        }
        existing = col_journals.find_one(query)
        if not existing:
            col_journals.insert_one(journal)
        else:
            print(f"SKIP REDUNDAN: {journal['title']}")


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
        page_start = 0
        page_end = 5
    author_urls = get_all_author_urls(page_start, page_end)
    print(f"Total author dari page {page_start} sampai {page_end}: {len(author_urls)}")

    # STEP 2: ambil publikasi tiap author
    journals = []
    for url in author_urls:
        pub_url = url + "?view=garuda"
        print("Fetching:", pub_url)
        r = requests.get(pub_url, headers=headers)
        s = BeautifulSoup(r.text, "html.parser")
        for item in s.select(".ar-list-item"):
            title_tag = item.select_one(".ar-title a")
            journal_tag = item.select_one(".ar-meta .ar-pub")
            year_tag = item.select_one(".ar-meta .ar-year")
            doi_tag = item.select_one(".ar-meta .ar-cited")
            # Ambil semua a[href^='#!'] di .ar-meta, exclude yang ada class ar-year, ar-cited, ar-quartile
            meta_links = item.select(".ar-meta a[href^='#!']")
            author_line = None
            for a in meta_links:
                if not a.get('class') or ('ar-year' not in a.get('class') and 'ar-cited' not in a.get('class') and 'ar-quartile' not in a.get('class')):
                    if ';' in a.text:
                        author_line = a.text.strip()
                        break
                    elif ',' in a.text:
                        author_line = a.text.strip()
                        break
            authors = []
            if author_line:
                if ';' in author_line:
                    # Banyak author, split berdasarkan ;
                    raw_authors = [n.strip() for n in author_line.split(';') if n.strip()]
                    for raw in raw_authors:
                        # Jika ada koma, urutkan nama ("Lubis, Muharman" -> "Muharman Lubis")
                        if ',' in raw:
                            parts = [p.strip() for p in raw.split(',')]
                            if len(parts) == 2:
                                authors.append(f"{parts[1]} {parts[0]}")
                            else:
                                authors.append(raw)
                        else:
                            authors.append(raw)
                else:
                    # Satu author, jika ada koma, urutkan nama
                    if ',' in author_line:
                        parts = [p.strip() for p in author_line.split(',')]
                        if len(parts) == 2:
                            authors.append(f"{parts[1]} {parts[0]}")
                        else:
                            authors.append(author_line)
                    else:
                        authors.append(author_line)
            # Format authorsDetailed
            authorsDetailed = []
            for name in authors:
                authorsDetailed.append({
                    "name": name,
                    "authid": "",
                    "hIndex": 0,
                    "fullName": name
                })
            # Format affiliations
            affiliations = ["Telkom University"]
            if title_tag:
                journal_data = {
                    "affiliations": affiliations,
                    "authors": authors,
                    "authorsDetailed": authorsDetailed,
                    "title": title_tag.text.strip() if title_tag else "",
                    "url": title_tag["href"] if title_tag else "",
                    "doi": doi_tag.text.strip() if doi_tag else "",
                    "eid": "",  # default sesuai contoh gambar
                    "publicationName": journal_tag.text.strip() if journal_tag else "",
                    "publicationYear": year_tag.text.strip() if year_tag else "",
                    "citation": 0,
                    "coverDate": ""  # default sesuai contoh gambar
                }
                print(journal_data)
                upsert_journal(journal_data)
                journals.append(journal_data)
        time.sleep(3)  # WAJIB agar tidak diblokir
    print("Journal ditemukan:", len(journals))

if __name__ == "__main__":
    main()
