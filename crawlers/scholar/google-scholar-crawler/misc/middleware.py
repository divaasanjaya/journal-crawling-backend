

import logging
from .proxy import PROXIES
from .agents import AGENTS

import random



logger = logging.getLogger(__name__)


class CustomHttpProxyMiddleware(object):
    def process_request(self, request, spider):
        # Use proxy for every request (rotate)
        if self.use_proxy(request):
            p = random.choice(PROXIES)
            try:
                request.meta['proxy'] = "http://%s" % p['ip_port']
                logger.info(f"Using proxy: {request.meta['proxy']}")
            except Exception as e:
                logger.critical(f"Exception {e}")

    def use_proxy(self, request):
        # Always use proxy for Google Scholar
        return True


class CustomUserAgentMiddleware(object):
    def process_request(self, request, spider):
        agent = random.choice(AGENTS)
        request.headers['User-Agent'] = agent
        # Add more headers to mimic real browsers
        request.headers['Accept-Language'] = 'en-US,en;q=0.9'
        request.headers['Accept-Encoding'] = 'gzip, deflate, br'
        request.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        request.headers['Connection'] = 'keep-alive'
        request.headers['Upgrade-Insecure-Requests'] = '1'
