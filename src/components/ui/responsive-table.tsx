interface Column<T> {
  key: string;
  label: string;
  render?: (value: any, row: T) => React.ReactNode;
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
}

export function ResponsiveTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
}: ResponsiveTableProps<T>) {
  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted border-b">
            <tr>
              {columns.map(col => (
                <th key={col.key} className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((row, i) => (
              <tr 
                key={i} 
                onClick={() => onRowClick?.(row)}
                className={onRowClick ? "hover:bg-muted/50 cursor-pointer transition-colors" : ""}
              >
                {columns.map(col => (
                  <td key={col.key} className="px-6 py-4 text-sm text-foreground">
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {data.map((row, i) => (
          <div 
            key={i}
            onClick={() => onRowClick?.(row)}
            className={`bg-card rounded-lg p-4 shadow border ${
              onRowClick ? "hover:border-primary cursor-pointer" : ""
            } transition-colors`}
          >
            {columns.map(col => (
              <div key={col.key} className="mb-2 last:mb-0">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">{col.label}</span>
                <div className="text-sm font-medium text-foreground mt-1">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}