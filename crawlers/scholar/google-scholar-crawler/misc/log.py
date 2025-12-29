

import logging
logger = logging.getLogger(__name__)

def warn(msg):
    logger.warning(str(msg))


def info(msg):
    logger.info(str(msg))


def debug(msg):
    logger.debug(str(msg))

import pprint
class MyPrettyPrinter(pprint.PrettyPrinter):
    def format(self, object, context, maxlevels, level):
        if isinstance(object, unicode):
            return (object.encode('utf8'), True, False)
        return pprint.PrettyPrinter.format(self, object, context, maxlevels, level)
pu = MyPrettyPrinter()

pp = pprint.PrettyPrinter()
