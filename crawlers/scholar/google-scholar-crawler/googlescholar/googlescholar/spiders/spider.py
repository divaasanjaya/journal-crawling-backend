
import re
import json
import pdb
from urllib.parse import urlparse
import urllib.parse



from scrapy.selector import Selector
try:
    from scrapy.spiders import Spider
except ImportError:
    from scrapy.spider import BaseSpider as Spider
from scrapy.utils.response import get_base_url
try:
    from scrapy.spiders import CrawlSpider, Rule
    from scrapy.linkextractors import LinkExtractor as sle
except ImportError:
    from scrapy.contrib.spiders import CrawlSpider, Rule
    from scrapy.contrib.linkextractors.sgml import SgmlLinkExtractor as sle
from scrapy.http import Request


from googlescholar.items import *
from misc.log import *
from misc.spider import CommonSpider


def _monkey_patching_HTTPClientParser_statusReceived():
    """
    monkey patching for scrapy.xlib.tx._newclient.HTTPClientParser.statusReceived
    """
    from twisted.web._newclient import HTTPClientParser, ParseError
    old_sr = HTTPClientParser.statusReceived

    def statusReceived(self, status):
        try:
            return old_sr(self, status)
        except ParseError as e:
            if e.args[0] == 'wrong number of parts':
                return old_sr(self, status + ' OK')
            raise
    statusReceived.__doc__ == old_sr.__doc__
    HTTPClientParser.statusReceived = statusReceived


class googlescholarSpider(CommonSpider):
    name = "googlescholar"
    allowed_domains = ["google.com"]
    start_urls = [
        "http://scholar.google.com/scholar?as_ylo=2011&q=machine+learning&hl=en&as_sdt=0,5",
        #"http://scholar.google.com/scholar?q=estimate+ctr&btnG=&hl=en&as_sdt=0%2C5&as_ylo=2011",
        #"http://scholar.google.com",
    ]
    rules = [
        Rule(sle(allow=(r"scholar\?.*")), callback='parse_1', follow=False),
        Rule(sle(allow=(r".*\.pdf"))),
    ]

    def __init__(self, start_url='', *args, **kwargs):
        _monkey_patching_HTTPClientParser_statusReceived()
        if start_url:
            self.start_urls = [start_url]
        super(googlescholarSpider, self).__init__(*args, **kwargs)

    #.gs_ri: content besides related html/pdf
    list_css_rules = {
        '.gs_r.gs_or': {
            'title': '.gs_rt span, .gs_rt a::text',
            'url': '.gs_rt a::attr(href)',
            'authors': '.gs_a::text',
            'description': '.gs_rs, .gs_rs *::text',
            'citation-text': '.gs_fl a:contains("Cited by")::text',
            'citation-url': '.gs_fl a:contains("Cited by")::attr(href)',
            'journal-year-src': '.gs_a::text',
            'author-links': '.gs_a a::attr(href)',
        }
    }

    def start_requests(self):
        for url in self.start_urls:
            _monkey_patching_HTTPClientParser_statusReceived()
            yield Request(url, dont_filter=True)

    def save_pdf(self, response):
        path = self.get_path(response.url)
        info(path)
        with open(path, "wb") as f:
            f.write(response.body)


    def parse_1(self, response):
        info('Parse ' + response.url)
        try:
            with open('response_debug.html', 'w', encoding='utf-8') as f:
                f.write(response.text)
        except Exception as e:
            info(f'Failed to write response_debug.html: {e}')

        x = self.parse_with_rules(response, self.list_css_rules, dict)
        items = []
        if len(x) > 0:
            selector_key = list(self.list_css_rules.keys())[0]
            items = x[0].get(selector_key, [])

        for item in items:
            # --- Parse and map to Scopus-like format ---
            # Parse authors
            authors_str = item.get('authors', '')
            author_names = []
            if authors_str:
                # Remove trailing journal info if present
                author_names = authors_str.split('-')[0].split(',')
            author_names = [a.strip() for a in author_names if a.strip()]
            # Parse author links (if any)
            author_links = item.get('author-links', [])
            if isinstance(author_links, str):
                author_links = [author_links]
            # Build authorDetailed (no crawling yet, just name)
            authorDetailed = []
            for idx, name in enumerate(author_names):
                author_obj = {
                    'name': name,
                    'authId': None,
                    'hIndex': None,
                    'fullName': None
                }
                # Optionally, follow author link for more detail (not implemented here)
                authorDetailed.append(author_obj)

            # Parse citation
            citation = 0
            citation_text = item.get('citation-text', '')
            m = re.search(r'Cited by (\d+)', citation_text)
            if m:
                citation = int(m.group(1))

            # Parse publicationName and publicationYear
            pub_name = None
            pub_year = None
            journal_src = item.get('journal-year-src', '')
            if journal_src:
                # Example: "M Musa, MN Ismail,   - JOIV: International Journal on Informatics …, 2021 - joiv.org"
                parts = journal_src.split('-')
                if len(parts) > 1:
                    journal_part = parts[1].strip()
                    year_match = re.search(r'(\d{4})', journal_part)
                    pub_year = year_match.group(1) if year_match else None
                    pub_name = re.sub(r',?\s*\d{4}.*', '', journal_part).replace('…', '').strip()

            # Try to get DOI from url if possible (very rare in GS)
            doi = None
            url = item.get('url', None)
            if url and 'doi.org' in url:
                doi_match = re.search(r'doi\.org/(.+)', url)
                if doi_match:
                    doi = doi_match.group(1)

            # Compose result
            scopus_like = {
                'title': item.get('title', None),
                'affiliation': None,  # Not available from GS list
                'authorDetailed': authorDetailed,
                'citation': citation,
                'coverDate': pub_year,
                'doi': doi,
                'eid': None,  # Not available from GS
                'publicationName': pub_name,
                'publicationYear': pub_year,
                'url': url
            }
            info(f"Parsed item: {scopus_like}")
            yield scopus_like

