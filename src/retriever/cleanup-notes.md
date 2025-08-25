# Methods to Remove from ContextRetriever

These methods are now duplicated in SearchStrategy classes and should be removed:

1. buildFileQuery (line ~578-614)
2. buildSymbolQuery (line ~616-639) 
3. buildFileLikeQuery (line ~1747-1775)
4. buildSymbolLikeQuery (line ~1777-1835)
5. searchByFilePath (line ~1852-1903)

These are all private methods that are no longer being called since we're using the strategy pattern.