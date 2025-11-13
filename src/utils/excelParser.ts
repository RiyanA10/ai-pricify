import * as XLSX from 'xlsx';
import { CATEGORY_ELASTICITY, ALLOWED_CATEGORIES, ALLOWED_CURRENCIES } from './categoryElasticity';

export interface ProductData {
  product_name: string;
  category: string;
  current_price: number;
  current_quantity: number;
  cost_per_unit: number;
  currency: 'SAR' | 'USD';
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export const parseExcelFile = async (file: File): Promise<{
  data: ProductData[];
  errors: ValidationError[];
}> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        let jsonData: any[][];
        
        const fileName = file.name.toLowerCase();
        const isCSV = fileName.endsWith('.csv');
        
        // Parse file based on type
        const workbook = XLSX.read(data, { 
          type: 'binary',
          raw: !isCSV // For CSV, don't use raw mode to handle text properly
        });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        const errors: ValidationError[] = [];
        const products: ProductData[] = [];
        
        // Check for required columns (skip header row)
        if (jsonData.length < 2) {
          errors.push({ row: 0, field: 'file', message: 'File is empty or missing data rows' });
          resolve({ data: [], errors });
          return;
        }
        
        // Expected columns
        const expectedColumns = ['product_name', 'category', 'current_price', 'current_quantity', 'cost_per_unit', 'currency'];
        
        // Process data rows (skip header) - Maximum 10 products
        const maxProducts = 10;
        const dataRowsToProcess = Math.min(jsonData.length - 1, maxProducts);
        
        if (jsonData.length - 1 > maxProducts) {
          errors.push({ 
            row: 0, 
            field: 'file', 
            message: `Maximum ${maxProducts} products allowed. Only the first ${maxProducts} products will be processed.` 
          });
        }
        
        for (let i = 1; i <= dataRowsToProcess; i++) {
          const row = jsonData[i];
          const rowNum = i + 1;
          
          // Skip empty rows
          if (!row || row.length === 0 || !row[0]) continue;
          
          const product: any = {};
          let hasError = false;
          
          // Product name (Column A)
          if (!row[0] || typeof row[0] !== 'string' || row[0].trim() === '') {
            errors.push({ row: rowNum, field: 'product_name', message: 'Product name is required and must be text' });
            hasError = true;
          } else {
            product.product_name = row[0].trim();
          }
          
          // Category (Column B)
          if (!row[1] || !ALLOWED_CATEGORIES.includes(row[1])) {
            errors.push({ 
              row: rowNum, 
              field: 'category', 
              message: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` 
            });
            hasError = true;
          } else {
            product.category = row[1];
          }
          
          // Current price (Column C)
          const currentPrice = Number(row[2]);
          if (isNaN(currentPrice) || currentPrice <= 0) {
            errors.push({ row: rowNum, field: 'current_price', message: 'Current price must be a positive number' });
            hasError = true;
          } else {
            product.current_price = currentPrice;
          }
          
          // Current quantity (Column D)
          const currentQuantity = Number(row[3]);
          if (isNaN(currentQuantity) || currentQuantity <= 0 || !Number.isInteger(currentQuantity)) {
            errors.push({ row: rowNum, field: 'current_quantity', message: 'Current quantity must be a positive integer' });
            hasError = true;
          } else {
            product.current_quantity = currentQuantity;
          }
          
          // Cost per unit (Column E)
          const costPerUnit = Number(row[4]);
          if (isNaN(costPerUnit) || costPerUnit <= 0) {
            errors.push({ row: rowNum, field: 'cost_per_unit', message: 'Cost per unit must be a positive number' });
            hasError = true;
          } else if (product.current_price && costPerUnit >= product.current_price) {
            errors.push({ row: rowNum, field: 'cost_per_unit', message: 'Cost per unit must be less than current price' });
            hasError = true;
          } else {
            product.cost_per_unit = costPerUnit;
          }
          
          // Currency (Column F)
          if (!row[5] || !ALLOWED_CURRENCIES.includes(row[5] as any)) {
            errors.push({ row: rowNum, field: 'currency', message: 'Currency must be either SAR or USD' });
            hasError = true;
          } else {
            product.currency = row[5];
          }
          
          if (!hasError) {
            products.push(product as ProductData);
          }
        }
        
        resolve({ data: products, errors });
      } catch (error) {
        resolve({ 
          data: [], 
          errors: [{ row: 0, field: 'file', message: 'Failed to parse file. Please ensure it follows the template format.' }]
        });
      }
    };
    
    reader.readAsBinaryString(file);
  });
};

export const generateExcelTemplate = () => {
  const template = [
    ['product_name', 'category', 'current_price', 'current_quantity', 'cost_per_unit', 'currency'],
    ['Premium Wireless Earbuds Pro', 'Electronics & Technology', 49.99, 150, 25.00, 'SAR'],
  ];
  
  // Add category options as a separate sheet for dropdown reference
  const categorySheet = ALLOWED_CATEGORIES.map(cat => [cat]);
  const currencySheet = [['SAR'], ['USD']];
  
  const ws = XLSX.utils.aoa_to_sheet(template);
  const categoryWs = XLSX.utils.aoa_to_sheet(categorySheet);
  const currencyWs = XLSX.utils.aoa_to_sheet(currencySheet);
  
  // Set column widths for better readability
  ws['!cols'] = [
    { wch: 30 }, // product_name
    { wch: 25 }, // category
    { wch: 15 }, // current_price
    { wch: 18 }, // current_quantity
    { wch: 15 }, // cost_per_unit
    { wch: 10 }  // currency
  ];
  
  // Create workbook and add sheets
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.utils.book_append_sheet(wb, categoryWs, 'Categories');
  XLSX.utils.book_append_sheet(wb, currencyWs, 'Currencies');
  
  // Add data validation using sheet references
  // Note: xlsx library has limited data validation support, so we add it manually in the XML
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Names) wb.Workbook.Names = [];
  
  // Define named ranges for dropdowns
  wb.Workbook.Names.push({
    Name: 'CategoryList',
    Ref: `Categories!$A$1:$A$${ALLOWED_CATEGORIES.length}`
  });
  
  wb.Workbook.Names.push({
    Name: 'CurrencyList',
    Ref: 'Currencies!$A$1:$A$2'
  });
  
  // Generate and download
  XLSX.writeFile(wb, 'AI_Truest_Template.xlsx');
};
