interface ProgressBarProps {
  current: number;
  total: number;
  label: string;
}

export function ProgressBar({ current, total, label }: ProgressBarProps) {
  const percentage = (current / total) * 100;
  
  return (
    <div className="w-full">
      <div className="flex justify-between mb-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">{current}/{total}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div 
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}