class BankingError(Exception):
    def __init__(self, message, code=None, details=None):
        self.message = message
        self.code = code
        self.details = details or {}
        super().__init__(self.message)


class CSVParseError(BankingError):
    pass


class AlreadyMatched(BankingError):
    pass


class CurrencyMismatch(BankingError):
    pass
