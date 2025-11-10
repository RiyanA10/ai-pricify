import { LucideIcon, AlertCircle } from "lucide-react";
import { Input } from "./input";
import { Label } from "./label";

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
  icon?: LucideIcon;
}

export function FormInput({
  label,
  error,
  helperText,
  required,
  icon: Icon,
  ...props
}: FormInputProps) {
  return (
    <div className="mb-4">
      <Label className="block text-sm font-medium mb-1">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <Input
          className={`${Icon ? 'pl-10' : ''} ${error ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          {...props}
        />
      </div>
      {error && (
        <p className="mt-1 text-sm text-destructive flex items-center gap-1">
          <AlertCircle className="w-4 h-4" />
          {error}
        </p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}