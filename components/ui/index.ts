/**
 * AvoMessage UI primitives — import via `@/components/ui`.
 *
 * Every component is hand-rolled (shadcn spirit), theme-aware (light/dark),
 * keyboard-accessible, and built on the design tokens in `app/globals.css`.
 */

export { cn } from "./utils";

export { Icon, type IconName, type IconProps } from "./icons";

export { Button, type ButtonProps } from "./button";
export { Input, Textarea, type InputProps, type TextareaProps } from "./input";
export { OtpInput, type OtpInputProps } from "./otp-input";
export { Label, FormField, type LabelProps, type FormFieldProps } from "./form-field";
export {
  Avatar,
  PresenceDot,
  toPresenceStatus,
  presenceLabelFor,
  type AvatarProps,
  type PresenceStatus,
} from "./avatar";
export { Badge, type BadgeProps } from "./badge";
export {
  RoleBadge,
  CompanyBadge,
  UserBadges,
  isAdminRole,
  isManagerRole,
  type RoleBadgeProps,
  type CompanyBadgeProps,
  type UserBadgesProps,
  type UserCompanyChip,
  type PlatformRoleName,
  type CompanyRoleName,
} from "./user-badges";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
} from "./card";
export { Dialog, DialogFooter, type DialogProps } from "./dialog";
export { Drawer, type DrawerProps } from "./drawer";
export {
  DropdownMenu,
  type DropdownMenuProps,
  type DropdownMenuItem,
  type DropdownMenuSection,
} from "./dropdown-menu";
export { Tabs, TabPanel, type TabsProps, type TabItem } from "./tabs";
export { Skeleton, SkeletonLines, type SkeletonProps } from "./skeleton";
export { Spinner, type SpinnerProps } from "./spinner";
export { Tooltip, type TooltipProps } from "./tooltip";
export { Switch, type SwitchProps } from "./switch";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { Select, type SelectProps, type SelectOption } from "./select";
export { Separator, type SeparatorProps } from "./separator";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentOption,
} from "./segmented-control";
export { ProgressBar, type ProgressBarProps } from "./progress-bar";

/* Toasts — `toast()` is safe to import from Server Components. */
export {
  toast,
  dismissToast,
  clearToasts,
  subscribeToasts,
  type ToastOptions,
  type ToastItem,
  type ToastVariant,
  type ToastAction,
} from "./toast";
export { Toaster } from "./toaster";

/* State views */
export {
  LoadingState,
  EmptyState,
  ErrorState,
  SuccessState,
  type LoadingStateProps,
  type EmptyStateProps,
  type ErrorStateProps,
  type SuccessStateProps,
} from "./state-views";

export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";

/* Overlay utilities (for building custom overlays) */
export { MotionProvider } from "./motion-provider";
export {
  useScrollLock,
  useEscapeKey,
  useFocusTrap,
  useClickOutside,
  useMounted,
  getFocusableElements,
} from "./use-overlay";
