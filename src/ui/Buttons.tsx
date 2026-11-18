import type { ComponentPropsWithRef } from 'react';

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'secondary' | 'primary' | 'danger' | 'text';
  small?: boolean;
};

const buttonClasses = { secondary: 'button', primary: 'button primary', danger: 'button danger', text: 'text-button' };

export function Button({ variant = 'secondary', small = false, className = '', type = 'button', ...props }: ButtonProps) {
  const classes = [buttonClasses[variant], small && 'small', className].filter(Boolean).join(' ');
  return <button {...props} type={type} className={classes} />;
}

type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'title' | 'aria-label' | 'type'> & {
  label: string;
};

export function IconButton({ label, className = '', ...props }: IconButtonProps) {
  const classes = ['icon-button', className].filter(Boolean).join(' ');
  return <button {...props} type="button" className={classes} title={label} aria-label={label} />;
}
