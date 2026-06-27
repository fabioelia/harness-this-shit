import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-45 select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-brand text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset] hover:bg-brand-deep active:translate-y-px',
        secondary:
          'bg-surface-2 text-fg border border-line hover:border-brand/50 hover:bg-surface-2 active:translate-y-px',
        ghost: 'text-muted hover:text-fg hover:bg-surface-2',
        outline: 'border border-line text-fg hover:border-brand/50 hover:bg-surface-2',
        danger: 'bg-bad/90 text-white hover:bg-bad active:translate-y-px',
        subtle: 'bg-surface text-muted hover:text-fg border border-line-soft hover:border-line',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-3.5',
        lg: 'h-10 px-5',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  }
);
Button.displayName = 'Button';
