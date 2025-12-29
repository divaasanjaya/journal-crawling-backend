Scopus API crawler

This folder contains a minimal Node.js script `run.js` that queries the Elsevier Scopus Search API and outputs JSON.

Usage

1. Install Node if not present.
2. Provide your Scopus API key via environment variable or CLI:

```bash
# example (Windows PowerShell)
$env:SCOPUS_API_KEY = 'YOUR_API_KEY'
node crawlers/scopus_api/run.js --affil="Telkom University" --startYear=2019 --endYear=2019 --count=25

# or pass directly
node crawlers/scopus_api/run.js --apiKey=YOUR_API_KEY --affil="Telkom University" --startYear=2019 --endYear=2019
```

Notes

- The script uses the public Scopus Search API endpoint `https://api.elsevier.com/content/search/scopus`.
- Rate limits and API access depend on your Elsevier subscription — ensure your API key has access to Scopus.
- The script does simple pagination and returns a flattened array of article objects.
