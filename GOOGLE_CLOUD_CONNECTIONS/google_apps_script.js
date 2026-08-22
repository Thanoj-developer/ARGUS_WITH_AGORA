function doPost(e) {
  try {
    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action;
    
    // Replace with your spreadsheet ID if standalone, or it will try to get the active one
    var spreadsheetId = "1mrK2edmGTbWJE0NofxYLDQ7dYWewch1qCEf6shmhOYI"; 
    var ss;
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(spreadsheetId);
    } catch(err) {
      ss = SpreadsheetApp.openById(spreadsheetId);
    }
    
    if (action === 'getSheets') {
      var sheets = ss.getSheets().map(function(sheet) {
        return sheet.getName();
      });
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        sheets: sheets
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'readSheets') {
      var sheetNames = requestData.sheetNames || [];
      var data = {};
      
      sheetNames.forEach(function(sheetName) {
        var sheet = ss.getSheetByName(sheetName);
        if (!sheet) {
          data[sheetName] = [];
          return;
        }
        
        var values = sheet.getDataRange().getValues();
        if (values.length <= 1) {
          data[sheetName] = [];
          return;
        }
        
        var headers = values[0];
        var rows = [];
        for (var r = 1; r < values.length; r++) {
          var rowData = values[r];
          var obj = {};
          for (var c = 0; c < headers.length; c++) {
            var header = headers[c].toString().toLowerCase().trim();
            var cellVal = rowData[c];
            if (header === "id") obj.id = cellVal;
            else if (header === "title") obj.title = cellVal;
            else if (header === "brand") obj.brand = cellVal;
            else if (header === "price") obj.price = parseFloat(cellVal) || cellVal;
            else if (header === "original price") obj.original_price = parseFloat(cellVal) || cellVal;
            else if (header === "discount %") obj.discount_pct = parseFloat(cellVal) || cellVal;
            else if (header === "rating") obj.rating = parseFloat(cellVal) || cellVal;
            else if (header === "reviews count") obj.review_count = parseInt(cellVal) || cellVal;
            else if (header === "sponsored") obj.is_sponsored = (cellVal === "TRUE" || cellVal === true);
            else if (header === "link") obj.url = cellVal;
            else obj[headers[c]] = cellVal;
          }
          rows.push(obj);
        }
        data[sheetName] = rows;
      });
      
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        data: data
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Default action: Export / append data
    var sheetName = requestData.sheetName || "Sheet1";
    var cleanData = requestData.data || {};
    var products = cleanData.products || [];
    
    // Clean sheetName
    var normalizedTabName = sheetName.replace(/[*?:\[\]\/\\']/g, '').substring(0, 30);
    var sheet = ss.getSheetByName(normalizedTabName);
    if (!sheet) {
      sheet = ss.insertSheet(normalizedTabName);
    }
    
    var rows = [];
    if (sheet.getLastRow() === 0) {
      // Add headers if sheet is empty
      rows.push(["ID", "Title", "Brand", "Price", "Original Price", "Discount %", "Rating", "Reviews Count", "Sponsored", "Link"]);
    }
    
    products.forEach(function(p) {
      rows.push([
        p.id || '',
        p.title || '',
        p.brand || '',
        p.price !== undefined && p.price !== null ? p.price : '',
        p.original_price !== undefined && p.original_price !== null ? p.original_price : '',
        p.discount_pct !== undefined && p.discount_pct !== null ? p.discount_pct : '',
        p.rating !== undefined && p.rating !== null ? p.rating : '',
        p.review_count !== undefined && p.review_count !== null ? p.review_count : '',
        p.is_sponsored ? 'TRUE' : 'FALSE',
        p.url || ''
      ]);
    });
    
    if (rows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "Successfully imported " + products.length + " products to sheet \"" + normalizedTabName + "\"!",
      spreadsheetUrl: ss.getUrl()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
