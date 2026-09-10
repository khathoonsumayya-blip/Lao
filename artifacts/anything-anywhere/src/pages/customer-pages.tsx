import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { type AddressSuggestion, type CheckoutDelivery, type SavedAddress, type SavedAddressInput, useAttachDeliveryPhoto, useCreateCustomerAddress, useCreateCustomerSupportTicketConversationReply, useCreateDelivery, useCreateDeliveryPhotoUploadUrl, useCreateDeliveryQuote, useCreateSupportTicket, useDeleteCustomerAddress, useGetDelivery, useGetDeliveryRoute, useGetDeliverySummary, useGetRecipientVerification, useGetStripePaymentConfig, useListCustomerAddresses, useListCustomerSupportTicketConversation, useListCustomerSupportTickets, useListDeliveries, useListDeliveryPhotos, useListNotifications, useUpdateCustomerAddress, getGetDeliveryQueryKey, getGetDeliveryRouteQueryKey, getGetDeliverySummaryQueryKey, getGetRecipientVerificationQueryKey, getGetStripePaymentConfigQueryKey, getListCustomerAddressesQueryKey, getListCustomerSupportTicketConversationQueryKey, getListCustomerSupportTicketsQueryKey, getListDeliveriesQueryKey, getListDeliveryPhotosQueryKey, getListNotificationsQueryKey } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, CircleHelp, Clock3, CreditCard, Headphones, Info, LockKeyhole, MapPin, MessageSquare, Navigation, Package, Phone, Plus, Receipt, Route as RouteIcon, Send, ShieldCheck, Star, Truck, UserRound, WalletCards } from 'lucide-react';
import { AppShell, EmptyState, ErrorState, LoadingState, PrimaryButton, SectionHeading } from '@/components/app-shell';
import { DeliveryMap } from '@/components/delivery-map';
import { StripePayment } from '@/components/stripe-payment';
import { apiUrl } from '@/lib/api-url';
import { customerTimeZoneLabel, formatCustomerPickupSchedule, pickupScheduleTimestamps, pickupWindows } from '@/lib/pickup-schedule';
import { clearBookingRouteDraft, readBookingRouteDraft, writeBookingRouteDraft } from '@/booking-route-draft';
import { AddressSearchField } from '@/components/address-search-field';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';

const money = (value?: number) => `$${(value ?? 0).toFixed(2)}`;
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const timeZoneLabel = customerTimeZoneLabel;
const todayLocal = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const scheduleTimestamps = pickupScheduleTimestamps;
const scheduleLabel = formatCustomerPickupSchedule;
function PickupScheduleSummary({ start, end, testId }: { start?: string | null; end?: string | null; testId: string }) {
  const label = scheduleLabel(start, end);
  return <p data-testid={testId} className="text-sm font-semibold text-[hsl(var(--accent))]">{label ? `Scheduled pickup: ${label}` : 'ASAP pickup'}</p>;
}
const statusLabel = (status = '') => status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const activeDeliveryStatuses = ['draft', 'quoted', 'payment_pending', 'paid', 'searching_driver', 'driver_assigned', 'driver_en_route_pickup', 'driver_arrived_pickup', 'pickup_verified', 'picked_up', 'in_transit', 'driver_arrived_delivery', 'delivery_verification_pending'];
const PROHIBITED_ITEMS_POLICY_VERSION = 'v1';
const PROHIBITED_ITEMS = ['Weapons or ammunition', 'Explosives, flammable, or hazardous materials', 'Illegal drugs or other unlawful items', 'Cash, currency, or negotiable instruments', 'Live animals'] as const;
const PROHIBITED_ITEMS_CONFIRMATION_TEXT = 'I confirm that my package does not contain any prohibited items.';
const PROHIBITED_ITEMS_CONFIRMATION_ERROR = 'Please confirm that your package does not contain prohibited items before continuing.';

function quoteErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
  }
  return 'We could not price that route right now. Please try again.';
}

function AddressCard({ icon: Icon, label, address, tint = 'bg-[hsl(var(--secondary))]' }: { icon: typeof MapPin; label: string; address: string; tint?: string }) {
  return <div className="flex gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3.5"><div className={`grid size-9 shrink-0 place-items-center rounded-lg ${tint} text-[hsl(var(--primary))]`}><Icon className="size-4" /></div><div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</p><p className="mt-1 truncate text-sm font-semibold text-[hsl(var(--primary))]">{address || 'Address not added yet'}</p></div></div>;
}

type LocationSelection = AddressDetails & { address: string; latitude?: number; longitude?: number };

function savedAddressSelection(address: SavedAddress): LocationSelection {
  return {
    address: address.fullAddress,
    street: address.street,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    latitude: address.latitude ?? undefined,
    longitude: address.longitude ?? undefined,
  };
}

function SavedAddressPicker({ kind, onSelect }: { kind: 'pickup' | 'dropoff'; onSelect: (address: SavedAddress) => void }) {
  const [open, setOpen] = useState(false);
  const addresses = useListCustomerAddresses({ query: { queryKey: getListCustomerAddressesQueryKey(), retry: false } });
  const label = kind === 'pickup' ? 'Pickup' : 'Drop-off';
  return <Drawer open={open} onOpenChange={setOpen}>
    <DrawerTrigger asChild><button type="button" className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-[hsl(var(--accent))]" data-testid={`button-${kind}-saved-addresses`}><MapPin className="size-4" /> Saved Addresses</button></DrawerTrigger>
    <DrawerContent className="max-h-[85dvh]">
      <DrawerHeader className="text-left"><DrawerTitle>Choose a saved {label.toLowerCase()} address</DrawerTitle><DrawerDescription>Select one of your regular stops for this field.</DrawerDescription></DrawerHeader>
      <div className="overflow-y-auto px-4 pb-2">
        {addresses.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /> : addresses.isError ? <ErrorState title="Saved addresses are unavailable" onRetry={() => addresses.refetch()} /> : addresses.data?.length ? <div className="space-y-2">{addresses.data.map((address) => <button key={address.id} type="button" onClick={() => { onSelect(address); setOpen(false); }} className="flex min-h-16 w-full items-start gap-3 rounded-xl border border-[hsl(var(--border))] p-4 text-left hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--secondary))]" data-testid={`button-${kind}-saved-address-${address.id}`}><MapPin className="mt-0.5 size-5 shrink-0 text-[hsl(var(--accent))]" /><span className="min-w-0"><span className="block text-sm font-bold text-[hsl(var(--primary))]">{address.label}{address.isDefault ? ' · Default' : ''}</span><span className="mt-1 block text-sm leading-5 text-[hsl(var(--muted-foreground))]">{address.fullAddress}</span></span></button>)}</div> : <div className="rounded-xl bg-[hsl(var(--secondary))] p-5 text-center"><p className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">No saved addresses yet</p><DrawerClose asChild><Link href="/profile" className="mt-3 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold text-[hsl(var(--accent))]">Add Address</Link></DrawerClose></div>}
      </div>
      <DrawerFooter><DrawerClose asChild><button type="button" className="min-h-11 rounded-full border border-[hsl(var(--border))] px-4 text-sm font-bold text-[hsl(var(--primary))]">Cancel</button></DrawerClose></DrawerFooter>
    </DrawerContent>
  </Drawer>;
}

export function HomePage() {
  const [, setLocation] = useLocation();
  const summary = useGetDeliverySummary({ query: { queryKey: getGetDeliverySummaryQueryKey() } });
  const data = summary.data;
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pickupSelection, setPickupSelection] = useState<LocationSelection | null>(null);
  const [dropoffSelection, setDropoffSelection] = useState<LocationSelection | null>(null);
  const [homeError, setHomeError] = useState('');
  const continueToBooking = () => {
    if (pickup.trim().length < 3 || dropoff.trim().length < 3) {
      setHomeError('Add both addresses to continue.');
      return;
    }
    try {
      writeBookingRouteDraft(sessionStorage, {
        pickupAddress: pickup,
        dropoffAddress: dropoff,
        pickupSelection,
        dropoffSelection,
      });
    } catch { /* Booking remains available if storage is blocked. */ }
    setLocation('/book');
  };
  return <AppShell><div className="mx-auto max-w-5xl animate-enter space-y-6">
    <section className="aa-hero relative overflow-hidden rounded-3xl bg-[hsl(var(--primary))] px-6 py-8 text-[hsl(var(--primary-foreground))] shadow-soft sm:px-10 sm:py-10">
      <div className="relative max-w-xl">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--chart-3))]">Lao</p>
        <h1 className="mt-4 font-display text-4xl font-extrabold leading-[.98] tracking-[-.06em] sm:text-6xl">Send it.<br /><span className="text-[hsl(var(--accent))]">We’ll handle the rest.</span></h1>
        <p className="mt-4 max-w-md text-base leading-7 text-[hsl(var(--primary-foreground))]/70">Fast, thoughtful delivery for the things that matter.</p>
      </div>
    </section>
    <section className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft sm:p-8" aria-labelledby="start-delivery-heading">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Start a delivery</p><h2 id="start-delivery-heading" className="mt-1 font-display text-2xl font-bold tracking-[-.04em] text-[hsl(var(--primary))]">Where should we go?</h2></div>
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><RouteIcon className="size-5" /></div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div><AddressSearchField label="Pick up from" value={pickup} onChange={(value) => { setPickup(value); setPickupSelection(null); setHomeError(''); }} onSelect={(suggestion) => { setPickup(suggestion.address); setPickupSelection(suggestion); setHomeError(''); }} placeholder="Enter pickup address" icon={<MapPin className="size-4" />} testId="input-home-pickup" /><SavedAddressPicker kind="pickup" onSelect={(address) => { const selection = savedAddressSelection(address); setPickup(selection.address); setPickupSelection(selection); setHomeError(''); }} /></div>
        <div><AddressSearchField label="Deliver to" value={dropoff} onChange={(value) => { setDropoff(value); setDropoffSelection(null); setHomeError(''); }} onSelect={(suggestion) => { setDropoff(suggestion.address); setDropoffSelection(suggestion); setHomeError(''); }} placeholder="Enter delivery address" icon={<RouteIcon className="size-4" />} testId="input-home-dropoff" /><SavedAddressPicker kind="dropoff" onSelect={(address) => { const selection = savedAddressSelection(address); setDropoff(selection.address); setDropoffSelection(selection); setHomeError(''); }} /></div>
      </div>
      {homeError && <p className="mt-4 rounded-xl bg-[hsl(var(--accent))]/10 px-4 py-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{homeError}</p>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <PrimaryButton onClick={continueToBooking} className="min-h-12 w-full sm:w-auto" data-testid="button-home-continue">Continue to package details <ArrowRight className="size-4" /></PrimaryButton>
        <span className="text-center text-xs font-semibold text-[hsl(var(--muted-foreground))] sm:text-left">Upfront pricing. No tips.</span>
      </div>
    </section>
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-5 py-4">
      <div><p className="text-sm font-bold text-[hsl(var(--primary))]">Your deliveries</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{summary.isLoading ? 'Loading…' : `${data?.activeCount ?? 0} active · ${data?.pastCount ?? 0} delivered`}</p></div>
      <Link href="/orders" className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-[hsl(var(--primary))] underline decoration-[hsl(var(--accent))] decoration-2 underline-offset-4" data-testid="link-view-orders-home">View deliveries <ArrowRight className="size-4" /></Link>
    </section>
  </div></AppShell>;
}

type AddressDetails = { street?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null };
type BookingForm = { pickupAddress: string; dropoffAddress: string; pickupLatitude?: number; pickupLongitude?: number; pickupDetails?: AddressDetails; dropoffLatitude?: number; dropoffLongitude?: number; dropoffDetails?: AddressDetails; category: string; size: 'small' | 'medium' | 'large'; weight: 'under5' | '5to20' | '20to50'; care: 'standard' | 'fragile' | 'priority' | 'temperature'; priority: 'asap' | 'scheduled'; scheduledPickupDate: string; scheduledPickupWindow: string; pickupName: string; pickupPhone: string; pickupRole: string; pickupInstructions: string; recipientName: string; recipientPhone: string; recipientRole: string; deliveryInstructions: string; prohibitedItemsConfirmed: boolean };

export function BookPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const quoteMutation = useCreateDeliveryQuote();
  const [checkoutStorageKey] = useState(() => {
    const tabId = window.name.startsWith('anything-anywhere-booking:')
      ? window.name
      : `anything-anywhere-booking:${crypto.randomUUID()}`;
    window.name = tabId;
    return `anything-anywhere.checkout.idempotency-key:${tabId}`;
  });
  const [checkoutRequestKey, setCheckoutRequestKey] = useState(() => {
    try { return sessionStorage.getItem(checkoutStorageKey) ?? crypto.randomUUID(); }
    catch { return crypto.randomUUID(); }
  });
  const createMutation = useCreateDelivery({ request: { headers: { 'Idempotency-Key': checkoutRequestKey } } });
  const photoUploadMutation = useCreateDeliveryPhotoUploadUrl();
  const attachPhotoMutation = useAttachDeliveryPhoto();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [checkout, setCheckout] = useState<CheckoutDelivery | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoStatus, setPhotoStatus] = useState('');
  const [form, setForm] = useState<BookingForm>(() => {
    let draft: {
      pickupAddress?: string;
      dropoffAddress?: string;
      pickupSelection?: LocationSelection | null;
      dropoffSelection?: LocationSelection | null;
       priority?: 'asap' | 'scheduled';
       scheduledPickupDate?: string;
       scheduledPickupWindow?: string;
    } = {};
    try {
      draft = readBookingRouteDraft(sessionStorage);
    } catch { /* The booking form works without a home-screen draft. */ }
    return {
      pickupAddress: draft.pickupAddress ?? '',
      dropoffAddress: draft.dropoffAddress ?? '',
      pickupLatitude: draft.pickupSelection?.latitude,
      pickupLongitude: draft.pickupSelection?.longitude,
      pickupDetails: draft.pickupSelection ?? undefined,
      dropoffLatitude: draft.dropoffSelection?.latitude,
      dropoffLongitude: draft.dropoffSelection?.longitude,
      dropoffDetails: draft.dropoffSelection ?? undefined,
      category: 'Small parcels',
      size: 'small',
      weight: 'under5',
      care: 'standard',
      priority: draft.priority ?? 'asap',
      scheduledPickupDate: draft.scheduledPickupDate ?? '',
      scheduledPickupWindow: draft.scheduledPickupWindow ?? '',
      pickupName: '',
      pickupPhone: '',
      pickupRole: 'Sender',
      pickupInstructions: '',
      recipientName: '',
      recipientPhone: '',
      recipientRole: 'Recipient',
      deliveryInstructions: '',
      prohibitedItemsConfirmed: false,
    };
  });
  const hasShownInitialBookingStep = useRef(false);
  useEffect(() => {
    if (!hasShownInitialBookingStep.current) {
      hasShownInitialBookingStep.current = true;
      return () => {};
    }
    if (step === 4) {
      const timer = window.setTimeout(() => {
        const confirmationCard = document.getElementById('card-prohibited-items-confirmation');
        if (!confirmationCard) return;
        confirmationCard.scrollIntoView({ block: 'start', behavior: 'auto' });
        const cardTop = confirmationCard.getBoundingClientRect().top;
        window.scrollTo({ top: Math.max(0, window.scrollY + cardTop - 96), behavior: 'auto' });
        confirmationCard.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
      }, 100);
      return () => window.clearTimeout(timer);
    }
    window.requestAnimationFrame(() => {
      document.getElementById('booking-step-heading')?.focus();
    });
    return () => {};
  }, [step]);
  const update = (key: keyof BookingForm, value: string) => {
    if (key === 'priority' || key === 'scheduledPickupDate' || key === 'scheduledPickupWindow') {
      setQuote(null);
      setCheckout(null);
    }
    setForm((current) => ({ ...current, [key]: value }));
  };
  useEffect(() => {
    try { sessionStorage.setItem(checkoutStorageKey, checkoutRequestKey); } catch { /* Checkout recovery still works within this page. */ }
  }, [checkoutRequestKey, checkoutStorageKey]);
  useEffect(() => {
    writeBookingRouteDraft(sessionStorage, {
      pickupAddress: form.pickupAddress,
      dropoffAddress: form.dropoffAddress,
      pickupSelection: form.pickupAddress ? {
        address: form.pickupAddress,
        ...form.pickupDetails,
        latitude: form.pickupLatitude,
        longitude: form.pickupLongitude,
      } : null,
      dropoffSelection: form.dropoffAddress ? {
        address: form.dropoffAddress,
        ...form.dropoffDetails,
        latitude: form.dropoffLatitude,
        longitude: form.dropoffLongitude,
      } : null,
      priority: form.priority,
      scheduledPickupDate: form.scheduledPickupDate,
      scheduledPickupWindow: form.scheduledPickupWindow,
    });
  }, [
    form.pickupAddress,
    form.pickupDetails,
    form.pickupLatitude,
    form.pickupLongitude,
    form.dropoffAddress,
    form.dropoffDetails,
    form.dropoffLatitude,
    form.dropoffLongitude,
    form.priority,
    form.scheduledPickupDate,
    form.scheduledPickupWindow,
  ]);
  const setAddress = (kind: 'pickup' | 'dropoff', suggestion: LocationSelection) => setForm((current) => kind === 'pickup'
    ? { ...current, pickupAddress: suggestion.address, pickupLatitude: suggestion.latitude, pickupLongitude: suggestion.longitude, pickupDetails: suggestion }
    : { ...current, dropoffAddress: suggestion.address, dropoffLatitude: suggestion.latitude, dropoffLongitude: suggestion.longitude, dropoffDetails: suggestion });
  const clearAddressCoordinates = (kind: 'pickup' | 'dropoff', value: string) => setForm((current) => kind === 'pickup'
    ? { ...current, pickupAddress: value, pickupLatitude: undefined, pickupLongitude: undefined, pickupDetails: undefined }
    : { ...current, dropoffAddress: value, dropoffLatitude: undefined, dropoffLongitude: undefined, dropoffDetails: undefined });
  const uploadPackagePhoto = async (deliveryId: string, file: File) => {
    setPhotoStatus('Securing your package photo…');
    try {
      const upload = await photoUploadMutation.mutateAsync({ id: deliveryId, data: { name: file.name, size: file.size, contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' } });
      const response = await fetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error('Private upload failed.');
      await attachPhotoMutation.mutateAsync({ id: deliveryId, data: { objectPath: upload.objectPath, size: file.size, contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' } });
      setPhotoStatus('Package photo secured for your delivery team.');
    } catch {
      setPhotoStatus('We could not securely add that photo. Your delivery will continue without it.');
    }
  };
  const steps = ['Route', 'Package', 'Timing', 'People', 'Confirm'];
  const scheduledTimestamps = form.priority === 'scheduled' ? scheduleTimestamps(form.scheduledPickupDate, form.scheduledPickupWindow) : null;
  const canAdvance = step === 0 ? form.pickupAddress.length > 2 && form.dropoffAddress.length > 2 : step === 2 ? form.priority === 'asap' || Boolean(scheduledTimestamps) : step === 3 ? form.pickupName && form.pickupPhone.length > 6 && form.recipientName && form.recipientPhone.length > 6 : true;
  const stripeConfig = useGetStripePaymentConfig({ query: { queryKey: getGetStripePaymentConfigQueryKey(), enabled: Boolean(checkout) } });
  const next = () => {
    setError('');
    if (!canAdvance) {
      if (step === 2) { setError('Choose a valid pickup date and time window. Pickup times cannot start in the past.'); return; }
      setError(step === 0 ? 'Add both addresses so we know where to go.' : 'Please add names and phone numbers for both sides of the handoff.'); return;
    }
    if (step === 2) {
      const timing = form.priority === 'scheduled' && scheduledTimestamps ? { scheduledPickupStartAt: scheduledTimestamps.start, scheduledPickupEndAt: scheduledTimestamps.end } : {};
      quoteMutation.mutate({ data: { pickupAddress: form.pickupAddress, dropoffAddress: form.dropoffAddress, pickupLatitude: form.pickupLatitude, pickupLongitude: form.pickupLongitude, dropoffLatitude: form.dropoffLatitude, dropoffLongitude: form.dropoffLongitude, category: form.category, size: form.size, weight: form.weight, care: form.care, priority: form.priority, ...timing } }, { onSuccess: (result) => { setCheckoutRequestKey(crypto.randomUUID()); setQuote(result); setStep(3); }, onError: (quoteError) => setError(quoteErrorMessage(quoteError)) });
      return;
    }
    setStep((value) => Math.min(4, value + 1));
  };
  const submit = () => {
    setError('');
    if (!quote) { setError('Your quote is missing. Go back and refresh it.'); return; }
    if (!form.prohibitedItemsConfirmed) { setError(PROHIBITED_ITEMS_CONFIRMATION_ERROR); return; }
    const { prohibitedItemsConfirmed: _prohibitedItemsConfirmed, ...deliveryDetails } = form;
    const timing = form.priority === 'scheduled' && scheduledTimestamps ? { scheduledPickupStartAt: scheduledTimestamps.start, scheduledPickupEndAt: scheduledTimestamps.end } : {};
    createMutation.mutate({ data: { ...deliveryDetails, ...timing, quoteId: quote.id, prohibitedItemsConfirmed: true } }, { onSuccess: (delivery) => { setCheckout(delivery); if (photoFile) void uploadPackagePhoto(delivery.id, photoFile); }, onError: () => setError('We could not start a secure payment for this delivery. Please try again.') });
  };
  return <AppShell><div className="mx-auto max-w-4xl animate-enter"><Link href="/" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" data-testid="link-back-home"><ArrowLeft className="size-4" /> Back home</Link><SectionHeading eyebrow="Book a delivery" title="A few details, then you’re set." description="Choose a route, package details, timing, and payment." /><div className="mb-8 flex items-center gap-1 overflow-x-auto pb-2" role="navigation" aria-label="Delivery booking progress">{steps.map((label, index) => <div key={label} className="flex min-w-max items-center gap-2" aria-current={index === step ? 'step' : undefined}><div className={`grid size-8 place-items-center rounded-full text-xs font-bold ${index <= step ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`} aria-hidden="true">{index < step ? <Check className="size-4" /> : index + 1}</div><span className={`text-xs font-bold ${index === step ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{label}</span>{index < steps.length - 1 && <span className="mx-2 h-px w-7 bg-[hsl(var(--border))] sm:w-14" aria-hidden="true" />}</div>)}</div>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_300px]"><div className="min-w-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft sm:p-8">
        {step === 0 && <Step title="Where should we go?" subtitle="Enter both full addresses. Select a suggested match when you see one." ><div><AddressSearchField label="Pick up from" value={form.pickupAddress} onChange={(value) => clearAddressCoordinates('pickup', value)} onSelect={(suggestion) => setAddress('pickup', suggestion)} placeholder="Enter your pickup address" icon={<MapPin className="size-4" />} testId="input-pickup-address" /><SavedAddressPicker kind="pickup" onSelect={(address) => setAddress('pickup', savedAddressSelection(address))} /></div><div><AddressSearchField label="Deliver to" value={form.dropoffAddress} onChange={(value) => clearAddressCoordinates('dropoff', value)} onSelect={(suggestion) => setAddress('dropoff', suggestion)} placeholder="Enter your delivery address" icon={<RouteIcon className="size-4" />} testId="input-dropoff-address" /><SavedAddressPicker kind="dropoff" onSelect={(address) => setAddress('dropoff', savedAddressSelection(address))} /></div><RoutePreview pickup={form.pickupAddress} dropoff={form.dropoffAddress} pickupLatitude={form.pickupLatitude} pickupLongitude={form.pickupLongitude} dropoffLatitude={form.dropoffLatitude} dropoffLongitude={form.dropoffLongitude} /></Step>}
        {step === 1 && <Step title="What are you sending?" subtitle="Choose the package details that fit." ><CategoryGrid value={form.category} onChange={(value) => update('category', value)} /><label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 transition-colors hover:border-[hsl(var(--accent))]"><span><span className="block text-sm font-bold text-[hsl(var(--primary))]">Package photo <span className="font-normal text-[hsl(var(--muted-foreground))]">(optional)</span></span><span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">{photoFile ? `${photoFile.name} is ready to share with your delivery team.` : 'Add a reference photo for your delivery team.'}</span>{photoStatus && <span className="mt-1 block text-xs font-semibold text-[hsl(var(--primary))]" data-testid="status-package-photo">{photoStatus}</span>}</span><span className="rounded-lg bg-[hsl(var(--secondary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary))]">Choose photo</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setPhotoFile(null); setPhotoStatus('Choose a JPEG, PNG, or WebP image smaller than 10 MB.'); return; } setPhotoFile(file); setPhotoStatus(''); }} data-testid="input-package-photo" /></label><ChoiceGroup label="Package size" value={form.size} options={[['small', 'Small', 'Envelope or shoebox'], ['medium', 'Medium', 'Small bag or box'], ['large', 'Large', 'Bulky or multiple items']]} onChange={(v) => update('size', v)} testPrefix="choice-size" /><ChoiceGroup label="Approximate weight" value={form.weight} options={[['under5', 'Under 5 lb', 'Light and easy'], ['5to20', '5–20 lb', 'A loaded tote'], ['20to50', '20–50 lb', 'We’ll bring muscle']]} onChange={(v) => update('weight', v)} testPrefix="choice-weight" /><ChoiceGroup label="Package care" value={form.care} options={[['standard', 'Standard', 'Everyday items'], ['fragile', 'Fragile', 'Handle with care'], ['priority', 'Priority', 'Time sensitive'], ['temperature', 'Temperature Sensitive', 'Special handling']]} onChange={(v) => update('care', v)} testPrefix="choice-care" /><div className="aa-prohibited mt-5 rounded-xl p-4" data-testid="disclosure-prohibited-items"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[hsl(var(--destructive))]" /><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--destructive))]">Safety check</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--destructive))]">No weapons, cash, live animals, or hazardous materials.</p></div></div></div></Step>}
       {step === 2 && <Step title="When do you need it?" subtitle="Choose what works best for you." ><ChoiceGroup label="Timing" value={form.priority} options={[['asap', 'As soon as possible', 'Fastest available driver'], ['scheduled', 'Schedule a pickup', 'Choose a pickup window']]} onChange={(v) => { update('priority', v); setError(''); }} testPrefix="choice-priority" />{form.priority === 'scheduled' ? <ScheduleControls date={form.scheduledPickupDate} window={form.scheduledPickupWindow} onDateChange={(value) => { update('scheduledPickupDate', value); setError(''); }} onWindowChange={(value) => { update('scheduledPickupWindow', value); setError(''); }} /> : <div className="rounded-xl bg-[hsl(var(--secondary))] p-4"><div className="flex gap-3"><Info className="mt-0.5 size-4 shrink-0 text-[hsl(var(--primary))]" /><p className="text-sm leading-6 text-[hsl(var(--primary))]/75">We’ll find the fastest available driver.</p></div></div>}</Step>}
       {step === 3 && <Step title="Who is involved?" subtitle="Add the two people for this handoff." ><div className="flex items-center justify-between rounded-xl bg-[hsl(var(--secondary))] px-4 py-3"><span className="text-sm font-bold text-[hsl(var(--primary))]">Pickup contact</span><button type="button" onClick={() => { update('pickupName', 'Morgan Lee'); update('pickupPhone', '(555) 010-0101'); }} className="text-xs font-bold text-[hsl(var(--accent))]" data-testid="button-use-my-contact">Use my details</button></div><div className="grid gap-4 sm:grid-cols-3"><Field label="Name" value={form.pickupName} onChange={(v) => update('pickupName', v)} placeholder="Full name" icon={<UserRound className="size-4" />} testId="input-pickup-name" /><Field label="Phone" value={form.pickupPhone} onChange={(v) => update('pickupPhone', v)} placeholder="(555) 010-0147" type="tel" icon={<Phone className="size-4" />} testId="input-pickup-phone" /><Field label="Role" value={form.pickupRole} onChange={(v) => update('pickupRole', v)} placeholder="Sender" testId="input-pickup-role" /></div><Field label="Pickup instructions (optional)" value={form.pickupInstructions} onChange={(v) => update('pickupInstructions', v)} placeholder="Apartment, front desk, parking notes…" testId="input-pickup-instructions" /><div className="my-5 h-px bg-[hsl(var(--border))]" /><div className="flex items-center justify-between rounded-xl bg-[hsl(var(--secondary))] px-4 py-3"><span className="text-sm font-bold text-[hsl(var(--primary))]">Delivery contact</span></div><div className="grid gap-4 sm:grid-cols-3"><Field label="Name" value={form.recipientName} onChange={(v) => update('recipientName', v)} placeholder="Full name" icon={<UserRound className="size-4" />} testId="input-recipient-name" /><Field label="Phone" value={form.recipientPhone} onChange={(v) => update('recipientPhone', v)} placeholder="(555) 010-0188" type="tel" icon={<Phone className="size-4" />} testId="input-recipient-phone" /><Field label="Role" value={form.recipientRole} onChange={(v) => update('recipientRole', v)} placeholder="Recipient" testId="input-recipient-role" /></div><Field label="Delivery instructions (optional)" value={form.deliveryInstructions} onChange={(v) => update('deliveryInstructions', v)} placeholder="Ring the bell, leave with concierge…" testId="input-delivery-instructions" /></Step>}
          {step === 4 && <Step title="Review and pay." subtitle="Your delivery begins after payment is confirmed." ><div className="space-y-3"><AddressCard icon={MapPin} label="Pickup" address={form.pickupAddress} /><AddressCard icon={RouteIcon} label="Delivery" address={form.dropoffAddress} tint="bg-[hsl(var(--chart-3))]" /></div><div className="mt-5 grid gap-3 rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm sm:grid-cols-2"><p><span className="text-[hsl(var(--muted-foreground))]">Item</span><br /><strong>{form.category}</strong></p><p><span className="text-[hsl(var(--muted-foreground))]">Care</span><br /><strong>{statusLabel(form.care)}</strong></p><p><span className="text-[hsl(var(--muted-foreground))]">Pickup</span><br /><strong>{form.pickupName}</strong></p><p><span className="text-[hsl(var(--muted-foreground))]">Recipient</span><br /><strong>{form.recipientName}</strong></p></div><div className="aa-prohibited mt-5 scroll-mt-24 rounded-xl p-4" data-testid="card-prohibited-items-confirmation"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[hsl(var(--destructive))]" /><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--destructive))]">Prohibited items</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--destructive))]">For everyone’s safety, we cannot carry {PROHIBITED_ITEMS.join(', ').toLowerCase()}.</p><label className="mt-3 flex cursor-pointer items-start gap-3 text-sm font-semibold leading-5 text-[hsl(var(--primary))]"><input type="checkbox" checked={form.prohibitedItemsConfirmed} onChange={(event) => { setForm((current) => ({ ...current, prohibitedItemsConfirmed: event.target.checked })); if (event.target.checked) setError(''); }} className="mt-1 size-4 shrink-0 accent-[hsl(var(--accent))]" required data-testid="checkbox-prohibited-items-confirmation" /><span>{PROHIBITED_ITEMS_CONFIRMATION_TEXT}</span></label><p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Policy version {PROHIBITED_ITEMS_POLICY_VERSION} · Review in Terms & Safety.</p></div></div></div>{checkout && <div className="mt-5">{stripeConfig.isLoading && <p className="rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm font-semibold text-[hsl(var(--muted-foreground))]">Loading payment form…</p>}{stripeConfig.isError && <p className="rounded-xl bg-[hsl(var(--accent))]/10 p-4 text-sm font-semibold text-[hsl(var(--destructive))]">Payment is temporarily unavailable. Please refresh and try again.</p>}{stripeConfig.data && <StripePayment key={checkout.payment.paymentIntentId} publishableKey={stripeConfig.data.publishableKey} clientSecret={checkout.payment.clientSecret} returnUrl={`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/orders/${checkout.id}`} onError={setError} onPaymentConfirmed={() => { try { sessionStorage.removeItem(checkoutStorageKey); } catch {} clearBookingRouteDraft(sessionStorage); queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDeliverySummaryQueryKey() }); setLocation(`/orders/${checkout.id}`); }} />}</div>}<div className="mt-5 flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] p-4"><CreditCard className="size-5 text-[hsl(var(--primary))]" /><div className="flex-1"><p className="text-sm font-bold">Secure checkout</p><p className="text-xs text-[hsl(var(--muted-foreground))]">Your card details are handled by Stripe.</p></div><BadgeCheck className="size-5 text-[hsl(var(--chart-2))]" /></div></Step>}
        {error && <p className="mt-5 rounded-xl bg-[hsl(var(--accent))]/10 px-4 py-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert" data-testid="status-booking-error">{error}</p>}<div className="mt-8 flex items-center justify-between gap-3"><button onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || createMutation.isPending || Boolean(checkout)} className="min-h-11 rounded-full px-4 py-3 text-sm font-bold text-[hsl(var(--muted-foreground))] disabled:opacity-30" data-testid="button-book-back">Back</button>{step < 4 ? <PrimaryButton onClick={next} disabled={quoteMutation.isPending} data-testid="button-book-next">{quoteMutation.isPending ? 'Pricing your route…' : step === 2 ? 'Get my quote' : 'Continue'} <ArrowRight className="size-4" /></PrimaryButton> : checkout ? <span className="text-sm font-bold text-[hsl(var(--muted-foreground))]">Complete payment above</span> : <PrimaryButton onClick={submit} disabled={createMutation.isPending} data-testid="button-confirm-delivery">{createMutation.isPending ? 'Starting secure checkout…' : 'Continue to secure payment'} <LockKeyhole className="size-4" /></PrimaryButton>}</div>
      </div><aside className="h-fit rounded-2xl bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))] lg:sticky lg:top-24"><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--chart-3))]">Your quote</p>{quote ? <><p className="mt-3 font-display text-4xl font-extrabold" data-testid="text-quote-total">{money(quote.total)}</p><p className="mt-1 text-sm text-[hsl(var(--primary-foreground))]/60">Estimated arrival: {quote.eta}</p><p className="mt-3 rounded-lg bg-[hsl(var(--primary-foreground))]/10 p-3 text-xs font-semibold" data-testid="text-quote-pickup-window">{scheduleLabel(quote.scheduledPickupStartAt, quote.scheduledPickupEndAt) ? `Scheduled pickup: ${scheduleLabel(quote.scheduledPickupStartAt, quote.scheduledPickupEndAt)}` : 'ASAP pickup'}</p><div className="my-5 h-px bg-[hsl(var(--primary-foreground))]/15" /><div className="space-y-2 text-sm"><LineItem label="Base delivery" value={money(quote.baseFare)} /><LineItem label="Distance fee" value={money(quote.distanceFee)} /><LineItem label="Care fee" value={money(quote.careFee)} /><LineItem label="Service fee" value="$0.00" /><LineItem label="Tax" value={money(quote.tax)} /><LineItem label="Discount" value={money(quote.discount)} /></div><div className="mt-5 flex items-center gap-2 rounded-lg bg-[hsl(var(--primary-foreground))]/10 p-3 text-xs font-semibold"><ShieldCheck className="size-4 text-[hsl(var(--chart-3))]" /> No tip required — $0.00</div></> : <div className="mt-5 space-y-4 text-sm leading-6 text-[hsl(var(--primary-foreground))]/65"><p>Your clear, upfront price will appear here after you choose your route and care level.</p><div className="flex items-center gap-2"><LockKeyhole className="size-4 text-[hsl(var(--chart-3))]" /> Stripe-secured payment</div></div>}</aside></div>
  </div></AppShell>;
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  let reviewSchedule: { start?: string; end?: string } | null = null;
  if (title === 'Review and pay.') {
    const draft = readBookingRouteDraft(sessionStorage);
    reviewSchedule = draft.priority === 'scheduled'
      ? scheduleTimestamps(draft.scheduledPickupDate ?? '', draft.scheduledPickupWindow ?? '')
      : {};
  }
  return <div>
    <h2 id="booking-step-heading" tabIndex={-1} className="font-display text-2xl font-bold tracking-[-.04em] text-[hsl(var(--primary))]">{title}</h2>
    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p>
    {reviewSchedule && <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4"><PickupScheduleSummary start={reviewSchedule.start} end={reviewSchedule.end} testId="scheduled-pickup-review" /></div>}
    <div className="mt-7 space-y-5">{children}</div>
  </div>;
}
function ScheduleControls({ date, window, onDateChange, onWindowChange }: { date: string; window: string; onDateChange: (value: string) => void; onWindowChange: (value: string) => void }) {
  const today = todayLocal();
  const available = pickupWindows.filter(([start]) => date !== today || Number(start.slice(0, 2)) * 60 > new Date().getHours() * 60 + new Date().getMinutes());
  return <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4" data-testid="controls-scheduled-pickup">
    <div className="grid gap-4 sm:grid-cols-2">
      <label><span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Pickup date</span><input type="date" min={today} value={date} onChange={(event) => onDateChange(event.target.value)} className="min-h-12 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm font-semibold" data-testid="input-pickup-date" /></label>
      <label><span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Available pickup time window</span><select value={window} onChange={(event) => onWindowChange(event.target.value)} className="min-h-12 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm font-semibold" data-testid="select-pickup-window"><option value="">Choose a window</option>{available.map(([start, , label]) => <option key={start} value={start}>{label}</option>)}</select></label>
    </div>
    <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Times shown in your local timezone: {timeZoneLabel()}.</p>
    {date === today && available.length === 0 && <p className="mt-2 text-sm font-semibold text-[hsl(var(--destructive))]" role="status">No pickup windows remain today. Choose a future date.</p>}
  </div>;
}
function Field({ label, value, onChange, placeholder, icon, type = 'text', testId }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; icon?: ReactNode; type?: string; testId: string }) { return <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span><span className="relative block">{icon && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]">{icon}</span>}<input value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} className={`w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm font-medium text-[hsl(var(--primary))] outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground))]/70 focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent))]/10 ${icon ? 'pl-10' : ''}`} data-testid={testId} /></span></label>; }
function ChoiceGroup({ label, value, options, onChange, testPrefix }: { label: string; value: string; options: string[][]; onChange: (value: string) => void; testPrefix: string }) { return <fieldset><legend className="mb-2 text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</legend><div className="grid gap-2 sm:grid-cols-3">{options.map(([option, title, note]) => <button type="button" key={option} onClick={() => onChange(option)} aria-pressed={value === option} className={`rounded-xl border p-3 text-left transition-all ${value === option ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 ring-2 ring-[hsl(var(--accent))]/15' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:border-[hsl(var(--primary))]/40'}`} data-testid={`${testPrefix}-${option}`}><span className="flex items-center justify-between text-sm font-bold text-[hsl(var(--primary))]">{title}{value === option && <Check className="size-4 text-[hsl(var(--accent))]" />}</span><span className="mt-1 block text-xs leading-5 text-[hsl(var(--muted-foreground))]">{note}</span></button>)}</div></fieldset>; }
function CategoryGrid({ value, onChange }: { value: string; onChange: (value: string) => void }) { const categories = ['Documents', 'Food', 'Groceries', 'Medicine', 'Baby items', 'Pet items', 'Gifts', 'Electronics', 'Clothing', 'Small parcels', 'Other']; return <fieldset><legend className="mb-2 text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Package type</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{categories.map((category) => <button type="button" key={category} onClick={() => onChange(category)} className={`rounded-xl border px-3 py-3 text-left text-sm font-bold transition-all ${value === category ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--primary))] ring-2 ring-[hsl(var(--accent))]/15' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/40'}`} data-testid={`button-category-${category.toLowerCase().replaceAll(' ', '-')}`}>{category}</button>)}</div></fieldset>; }
function RoutePreview({ pickup, dropoff, pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude }: { pickup: string; dropoff: string; pickupLatitude?: number; pickupLongitude?: number; dropoffLatitude?: number; dropoffLongitude?: number }) {
  const hasCoordinates = pickupLatitude != null && pickupLongitude != null && dropoffLatitude != null && dropoffLongitude != null;
  const [encodedPolyline, setEncodedPolyline] = useState<string | null>(null);
  useEffect(() => {
    if (!hasCoordinates) { setEncodedPolyline(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(apiUrl('/api/deliveries/route-preview'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickupAddress: pickup, dropoffAddress: dropoff, category: 'Small parcels', size: 'small', weight: 'under5', care: 'standard', priority: 'asap' }),
        signal: controller.signal,
      }).then(async (response) => response.ok ? response.json() : null)
        .then((route) => { if (!controller.signal.aborted) setEncodedPolyline(typeof route?.encodedPolyline === 'string' ? route.encodedPolyline : null); })
        .catch(() => { if (!controller.signal.aborted) setEncodedPolyline(null); });
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [hasCoordinates, pickup, dropoff]);
  return <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4" data-testid="route-preview"><DeliveryMap pickup={{ label: pickup || 'Pickup pin waiting for an address', latitude: pickupLatitude, longitude: pickupLongitude, kind: 'pickup' }} dropoff={{ label: dropoff || 'Destination pin waiting for an address', latitude: dropoffLatitude, longitude: dropoffLongitude, kind: 'dropoff' }} encodedPolyline={encodedPolyline} demoMode={!hasCoordinates} title="Booking route preview" /><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">{hasCoordinates ? encodedPolyline ? 'Driving route confirmed from Google Maps.' : 'Finding a driving route…' : 'Add both addresses to preview the route.'}</p><span className="shrink-0 rounded-full bg-[hsl(var(--card))] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{hasCoordinates ? encodedPolyline ? 'Mapped' : 'Loading route' : 'Preview'}</span></div></div>;
}
function LineItem({ label, value }: { label: string; value: string }) { return <div className="flex justify-between text-[hsl(var(--primary-foreground))]/65"><span>{label}</span><span className="font-mono text-xs">{value}</span></div>; }

export function OrdersPage() {
  const deliveries = useListDeliveries({ query: { queryKey: getListDeliveriesQueryKey() } });
  const [tab, setTab] = useState<'active' | 'scheduled' | 'completed' | 'cancelled'>('active');
  const list = deliveries.data ?? [];
  const isScheduled = (delivery: any) => Boolean(delivery.scheduledPickupStartAt && delivery.scheduledPickupEndAt);
  const terminal = (delivery: any) => ['delivered', 'failed', 'refunded', 'cancelled', 'canceled', 'completed'].includes(delivery.status);
  const filtered = useMemo(() => list.filter((delivery) => tab === 'active' ? activeDeliveryStatuses.includes(delivery.status) && !isScheduled(delivery) : tab === 'scheduled' ? isScheduled(delivery) && !terminal(delivery) : tab === 'completed' ? ['delivered', 'failed', 'refunded', 'completed'].includes(delivery.status) : ['cancelled', 'canceled'].includes(delivery.status)), [list, tab]);
  return <AppShell><div className="animate-enter"><SectionHeading eyebrow="Your deliveries" title="Everything in one place." description="Follow a handoff from our desk to their doorstep." action={<Link href="/book" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--accent))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--accent-foreground))]" data-testid="link-book-orders"><Plus className="size-4" /> New delivery</Link>} /><div className="mb-6 grid grid-cols-4 gap-1 rounded-xl bg-[hsl(var(--muted))] p-1"><TabButton active={tab === 'active'} onClick={() => setTab('active')} label="Active" count={list.filter((d) => activeDeliveryStatuses.includes(d.status) && !isScheduled(d)).length} testId="tab-active" /><TabButton active={tab === 'scheduled'} onClick={() => setTab('scheduled')} label="Scheduled" count={list.filter((d) => isScheduled(d) && !terminal(d)).length} testId="tab-scheduled" /><TabButton active={tab === 'completed'} onClick={() => setTab('completed')} label="Completed" count={list.filter((d) => ['delivered', 'failed', 'refunded', 'completed'].includes(d.status)).length} testId="tab-completed" /><TabButton active={tab === 'cancelled'} onClick={() => setTab('cancelled')} label="Cancelled" count={list.filter((d) => ['cancelled', 'canceled'].includes(d.status)).length} testId="tab-cancelled" /></div>{deliveries.isLoading ? <LoadingState label="Loading your delivery history" /> : deliveries.isError ? <ErrorState onRetry={() => deliveries.refetch()} /> : filtered.length === 0 ? <EmptyState title={tab === 'active' ? 'Your road is clear.' : `No ${tab} deliveries yet.`} message={tab === 'scheduled' ? 'Scheduled deliveries appear here once you choose a pickup window.' : tab === 'active' ? 'When you book a delivery, its progress will show up here.' : 'Your delivery history will build here over time.'} action={tab === 'active' ? <Link href="/book" className="inline-flex rounded-full bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-empty-book">Book your first delivery</Link> : undefined} /> : <div className="space-y-3">{filtered.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery} />)}</div>}</div></AppShell>;
}

function TabButton({ active, onClick, label, count, testId }: { active: boolean; onClick: () => void; label: string; count: number; testId: string }) { return <button onClick={onClick} className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${active ? 'bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid={testId}>{label}<span className="ml-1.5 font-mono text-xs opacity-60">{count}</span></button>; }
function DeliveryRow({ delivery }: { delivery: any }) {
  const active = !['delivered', 'completed', 'cancelled', 'canceled'].includes(delivery.status);
  const window = scheduleLabel(delivery.scheduledPickupStartAt, delivery.scheduledPickupEndAt);
  return <Link href={`/orders/${delivery.id}`} className="group grid gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift sm:grid-cols-[1fr_auto] sm:items-center sm:p-5" data-testid={`link-delivery-${delivery.id}`}><div className="flex min-w-0 gap-4"><div className={`grid size-11 shrink-0 place-items-center rounded-xl ${active ? 'bg-[hsl(var(--secondary))]' : 'bg-[hsl(var(--muted))]'} text-[hsl(var(--primary))]`}><Package className="size-5" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs font-bold text-[hsl(var(--muted-foreground))]">{delivery.orderNumber}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${active ? 'bg-[hsl(var(--chart-3))]/30 text-[hsl(var(--primary))]' : delivery.status.includes('cancel') ? 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{statusLabel(delivery.status)}</span></div><p className="mt-2 truncate text-sm font-semibold text-[hsl(var(--primary))]">{delivery.pickupAddress} <ArrowRight className="mx-1 inline size-3 text-[hsl(var(--muted-foreground))]" /> {delivery.dropoffAddress}</p><p className="mt-1 text-xs font-semibold text-[hsl(var(--accent))]" data-testid={`text-delivery-window-${delivery.id}`}>{window ? `Scheduled pickup: ${window}` : 'ASAP pickup'} </p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{delivery.category} · Booked {dateLabel(delivery.createdAt)}</p></div></div><div className="flex items-center justify-between gap-5 sm:justify-end"><div className="sm:text-right"><p className="font-display text-xl font-bold text-[hsl(var(--primary))]">{money(delivery.total)}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{active ? `ETA ${delivery.eta}` : 'Receipt available'}</p></div><ArrowRight className="size-4 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-1" /></div></Link>;
}

export function DeliveryDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const delivery = useGetDelivery(id, { query: { enabled: Boolean(id), queryKey: getGetDeliveryQueryKey(id) } });
  const route = useGetDeliveryRoute(id, { query: { queryKey: getGetDeliveryRouteQueryKey(id), enabled: Boolean(id), refetchInterval: 60_000, retry: false } });
  const photos = useListDeliveryPhotos(id, { query: { queryKey: getListDeliveryPhotosQueryKey(id), enabled: Boolean(id), retry: false, staleTime: 60_000 } });
  const recipientVerification = useGetRecipientVerification(id, { query: { queryKey: getGetRecipientVerificationQueryKey(id), enabled: Boolean(id) && delivery.data?.status === 'delivery_verification_pending', retry: false } });
  if (delivery.isLoading) return <AppShell><LoadingState label="Finding your delivery" /></AppShell>;
  if (delivery.isError || !delivery.data) return <AppShell><ErrorState onRetry={() => delivery.refetch()} title="That delivery is playing hide-and-seek" /></AppShell>;
  const item = delivery.data;
  const events = item.events ?? [];
   const active = !['delivered', 'completed', 'cancelled', 'canceled'].includes(item.status);
   const findingDriver = item.status === 'searching_driver';
   const renderMappedDetail = Boolean(route.data);
    if (renderMappedDetail) return <CustomerRouteDetail item={item} route={route.data!} photos={photos.data ?? []} events={events} active={active} verification={recipientVerification.data} verificationLoading={recipientVerification.isLoading} verificationError={recipientVerification.isError} />;
    return <AppShell><div className="animate-enter"><Link href="/orders" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]" data-testid="link-back-orders"><ArrowLeft className="size-4" /> All deliveries</Link>{findingDriver && <section className="mb-6 overflow-hidden rounded-2xl bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))] shadow-soft sm:p-7" data-testid="panel-searching-driver"><div className="flex items-center gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-[hsl(var(--chart-3))]"><Package className="size-5 animate-pulse text-[hsl(var(--chart-3))]" /></div><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--chart-3))]">Dispatch in motion</p><h2 className="mt-1 font-display text-2xl font-bold">Ari is finding your delivery partner…</h2><p className="mt-2 text-sm text-[hsl(var(--primary-foreground))]/65">You can still contact the desk if something changes before a driver accepts.</p></div></div></section>}<div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="font-mono text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--accent))]">{item.orderNumber}</p><h1 className="mt-2 font-display text-4xl font-extrabold tracking-[-.06em] text-[hsl(var(--primary))]">{active ? 'On its way.' : item.status === 'delivered' ? 'Delivered successfully.' : statusLabel(item.status)}</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Booked {dateLabel(item.createdAt)}</p></div><span className="inline-flex w-fit items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary))]"><span className="size-2 rounded-full bg-[hsl(var(--chart-2))]" /> {active ? `Estimated arrival ${item.eta}` : 'Delivery complete'}</span></div><div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><div className="space-y-5"><div className="rounded-2xl bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))] sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--chart-3))]">Route</p><p className="mt-2 font-display text-2xl font-bold">{item.eta}</p><p className="mt-1 text-sm text-[hsl(var(--primary-foreground))]/60">Arrival estimate</p></div><div className="relative grid size-14 place-items-center rounded-full border border-[hsl(var(--primary-foreground))]/20"><Truck className="size-6 text-[hsl(var(--chart-3))]" /><span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-[hsl(var(--primary))] bg-[hsl(var(--accent))]" /></div></div><div className="my-6 flex items-center gap-3"><div className="h-2 flex-1 rounded-full bg-[hsl(var(--chart-3))]" /><div className="h-2 w-1/4 rounded-full bg-[hsl(var(--primary-foreground))]/15" /></div><div className="grid gap-4 sm:grid-cols-2"><div><p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--primary-foreground))]/45">Pickup</p><p className="mt-1 truncate text-sm font-semibold">{item.pickupAddress}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--primary-foreground))]/45">Destination</p><p className="mt-1 truncate text-sm font-semibold">{item.dropoffAddress}</p></div></div><div className="mt-5 rounded-xl border border-[hsl(var(--primary-foreground))]/15 bg-[hsl(var(--primary-foreground))]/5 p-4" data-testid="delivery-live-route">{route.isLoading ? <p className="text-sm text-[hsl(var(--primary-foreground))]/70">Loading route details…</p> : route.data?.status === 'available' ? <div><p className="text-sm font-bold">Verified driving route is ready.</p><p className="mt-1 text-xs text-[hsl(var(--primary-foreground))]/65">{route.data.distanceMeters ? `${(route.data.distanceMeters / 1609.34).toFixed(1)} mi · ` : ''}{route.data.durationSeconds ? `${Math.ceil(route.data.durationSeconds / 60)} min from the route provider` : 'Route details confirmed'}</p>{route.data.driverLocation && <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--chart-3))]/20 px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))]"><Navigation className="size-3.5 text-[hsl(var(--chart-3))]" /> Live driver marker updated {new Date(route.data.driverLocation.capturedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}</div> : <div><p className="text-sm font-bold">Live map unavailable</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--primary-foreground))]/65">{route.data?.message || 'Your delivery status remains up to date while route mapping reconnects.'}</p>{route.data?.driverLocation && <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--chart-3))]/20 px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))]"><Navigation className="size-3.5 text-[hsl(var(--chart-3))]" /> Driver location is available</p>}</div>}</div></div><div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><h2 className="font-display text-xl font-bold text-[hsl(var(--primary))]">Delivery timeline</h2>{events.length ? <div className="mt-6">{events.map((event, index) => <div className="relative flex gap-4 pb-6 last:pb-0" key={`${event.label}-${index}`}><div className="relative flex w-5 shrink-0 justify-center"><span className={`z-10 mt-0.5 grid size-5 place-items-center rounded-full ${event.completed ? 'bg-[hsl(var(--chart-2))] text-[hsl(var(--card))]' : 'border-2 border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}>{event.completed && <Check className="size-3" />}</span>{index < events.length - 1 && <span className="absolute top-5 h-full w-px bg-[hsl(var(--border))]" />}</div><div><p className={`text-sm font-bold ${event.completed ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{event.label}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{event.time ? dateLabel(event.time) : 'Coming up next'}</p></div></div>)}</div> : <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Timeline updates will appear as the desk moves your delivery forward.</p>}</div></div><aside className="space-y-5"><div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft"><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Your driver</p>{item.driverName ? <div className="mt-5 flex items-center gap-3"><div className="grid size-12 place-items-center rounded-full bg-[hsl(var(--secondary))] font-display font-bold text-[hsl(var(--primary))]">{item.driverName.split(' ').map((part: string) => part[0]).join('')}</div><div><p className="font-display text-lg font-bold text-[hsl(var(--primary))]">{item.driverName}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{item.vehicle || 'Local delivery vehicle'} {item.driverRating ? `· ${item.driverRating} rating` : ''}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Vehicle details confirmed at handoff</p></div><Star className="ml-auto size-4 fill-[hsl(var(--chart-3))] text-[hsl(var(--chart-3))]" /></div> : <div className="mt-4 rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm leading-6 text-[hsl(var(--primary))]/75">We’re matching the best local driver to your route now. You’ll see their details here soon.</div>}</div>{photos.data?.length ? <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Private package photos</p><div className="mt-4 grid grid-cols-2 gap-2">{photos.data.map((photo) => <a key={photo.id} href={photo.downloadUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-[hsl(var(--border))]"><img src={photo.downloadUrl} alt="Private package reference" className="aspect-square w-full object-cover" /></a>)}</div><p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">These links are short-lived and are shown only to your delivery team.</p></div> : null}<div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><div className="flex items-center justify-between"><h2 className="font-display text-xl font-bold text-[hsl(var(--primary))]">Receipt</h2><Receipt className="size-5 text-[hsl(var(--accent))]" /></div><div className="mt-5 flex items-end justify-between border-t border-[hsl(var(--border))] pt-4"><span className="text-sm text-[hsl(var(--muted-foreground))]">Total · test payment</span><strong className="font-display text-2xl text-[hsl(var(--primary))]" data-testid="text-receipt-total">{money(item.total)}</strong></div><p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">No tips. No hidden fees. This receipt is a test payment record and does not represent a real charge.</p></div><div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4"><p className="text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--primary))]">Delivery verification</p><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">A short-lived recipient code will be shown only when the delivery reaches its verification step. It is never saved in plain text.</p></div><Link href="/support" className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4 text-sm font-bold text-[hsl(var(--primary))] transition-transform hover:-translate-y-0.5" data-testid="link-detail-support"><MessageSquare className="size-5" /> Need help with this delivery <ArrowRight className="ml-auto size-4" /></Link></aside></div></div></AppShell>;
}

function RecipientVerificationCard({ status, verification, isLoading, isError }: { status: string; verification?: { code: string; expiresAt: string }; isLoading: boolean; isError: boolean }) {
  const pending = status === 'delivery_verification_pending';
  return <section className={`rounded-2xl border p-5 ${pending ? 'border-[hsl(var(--chart-3))] bg-[hsl(var(--chart-3))]/15' : 'border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary))]'}`} data-testid="card-recipient-verification"><p className="text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--primary))]">Delivery verification</p>{!pending ? <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">A short-lived recipient code will be shown only when the delivery reaches its verification step. It is never saved in plain text.</p> : isLoading ? <p className="mt-3 text-sm font-semibold text-[hsl(var(--primary))]">Preparing your secure code…</p> : isError || !verification ? <p className="mt-3 text-sm font-semibold text-[hsl(var(--destructive))]">The code is unavailable. Refresh this delivery or contact support.</p> : <div className="mt-3"><p className="font-mono text-4xl font-black tracking-[.22em] text-[hsl(var(--primary))]" data-testid="text-recipient-code">{verification.code}</p><p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Share this code with your driver after you receive the package. It expires at {new Date(verification.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p></div>}</section>;
}

function CustomerRouteDetail({ item, route, photos, events, active, verification, verificationLoading, verificationError }: { item: any; route: any; photos: any[]; events: any[]; active: boolean; verification?: { code: string; expiresAt: string }; verificationLoading: boolean; verificationError: boolean }) {
  const demoMode = item.mapMode !== 'verified' || route.status !== 'available';
  const [followDriver, setFollowDriver] = useState(false);
  const driverAge = route.driverLocation ? Math.max(0, Math.floor((Date.now() - new Date(route.driverLocation.capturedAt).getTime()) / 60_000)) : null;
  const trackingText = !active ? 'Live location is no longer shared for this delivery.' : !route.driverLocation ? 'Waiting for your driver to enable secure location sharing.' : driverAge! > 3 ? `Last driver update ${driverAge} min ago` : driverAge === 0 ? 'Driver location updated just now' : `Last driver update ${driverAge} min ago`;
  return <AppShell><div className="animate-enter"><Link href="/orders" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft className="size-4" /> All deliveries</Link><div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--accent))]">{item.orderNumber}</p><h1 className="mt-2 font-display text-4xl font-extrabold tracking-[-.06em] text-[hsl(var(--primary))]">{active ? 'On its way.' : item.status === 'delivered' ? 'Delivered successfully.' : statusLabel(item.status)}</h1></div><span className="rounded-full bg-[hsl(var(--secondary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary))]">{active ? `Estimated arrival ${item.eta}` : 'Delivery complete'}</span></div><div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div className="space-y-5"><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft sm:p-5" data-testid="customer-live-map"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--accent))]">Live delivery route</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{route.status === 'available' ? `${route.distanceMeters ? `${(route.distanceMeters / 1609.34).toFixed(1)} mi · ` : ''}${route.durationSeconds ? `${Math.ceil(route.durationSeconds / 60)} min remaining` : 'Verified driving route'}` : route.message}</p></div>{route.driverLocation && <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--chart-3))]/25 px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary))]"><Navigation className="size-3.5" /> Driver live</span>}</div><DeliveryMap pickup={{ label: item.pickupAddress, latitude: item.pickupLatitude, longitude: item.pickupLongitude, kind: 'pickup' }} dropoff={{ label: item.dropoffAddress, latitude: item.dropoffLatitude, longitude: item.dropoffLongitude, kind: 'dropoff' }} driverLocation={route.driverLocation ? { label: `Driver update ${new Date(route.driverLocation.capturedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, latitude: route.driverLocation.latitude, longitude: route.driverLocation.longitude, kind: 'driver' } : null} encodedPolyline={route.encodedPolyline} demoMode={demoMode} title="Customer delivery route" followDriver={followDriver} /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className={`text-xs font-semibold ${route.driverLocation && driverAge! <= 3 ? 'text-emerald-600' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid="driver-location-status">{trackingText}</p><button onClick={() => setFollowDriver((following) => !following)} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary))]" aria-pressed={followDriver} data-testid="button-follow-driver">{followDriver ? 'Following driver' : 'Follow driver'}</button></div></section><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><h2 className="font-display text-xl font-bold text-[hsl(var(--primary))]">Delivery timeline</h2><div className="mt-5 space-y-3">{events.length ? events.map((event, index) => <div className="flex items-center gap-3" key={`${event.label}-${index}`}><span className={`grid size-5 place-items-center rounded-full ${event.completed ? 'bg-[hsl(var(--chart-2))] text-[hsl(var(--card))]' : 'border border-[hsl(var(--border))]'}`}>{event.completed && <Check className="size-3" />}</span><p className="text-sm font-semibold text-[hsl(var(--primary))]">{event.label}<span className="ml-2 text-xs font-normal text-[hsl(var(--muted-foreground))]">{event.time ? dateLabel(event.time) : 'Coming up'}</span></p></div>) : <p className="text-sm text-[hsl(var(--muted-foreground))]">Timeline updates will appear as the desk moves your delivery forward.</p>}</div></section></div><aside className="space-y-5"><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--accent))]">Delivery details</p><p className="mt-4 text-sm font-semibold text-[hsl(var(--primary))]">Pickup</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{item.pickupAddress}</p><p className="mt-4 text-sm font-semibold text-[hsl(var(--primary))]">Destination</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{item.dropoffAddress}</p>{item.driverName && <><p className="mt-4 text-sm font-semibold text-[hsl(var(--primary))]">Driver</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{item.driverName} · {item.vehicle || 'Local delivery vehicle'}</p></>}</section>{photos.length ? <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--accent))]">Private package photos</p><div className="mt-4 grid grid-cols-2 gap-2">{photos.map((photo) => <a key={photo.id} href={photo.downloadUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-[hsl(var(--border))]"><img src={photo.downloadUrl} alt="Private package reference" className="aspect-square w-full object-cover" /></a>)}</div></section> : null}<RecipientVerificationCard status={item.status} verification={verification} isLoading={verificationLoading} isError={verificationError} /><Link href="/support" className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4 text-sm font-bold text-[hsl(var(--primary))]"><MessageSquare className="size-5" /> Need help with this delivery <ArrowRight className="ml-auto size-4" /></Link></aside></div></div></AppShell>;
}

export function WalletPage() {
  return <AppShell><div className="animate-enter"><SectionHeading eyebrow="Payments" title="Payments and receipts." description="Add your card when you book. Your receipts stay here." /><div className="grid gap-5 lg:grid-cols-[1fr_1fr]"><section className="rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))] shadow-soft sm:p-8"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--chart-3))]">Payment options</p><p className="mt-5 font-display text-2xl font-bold">Pay at checkout</p><p className="mt-2 text-sm text-[hsl(var(--primary-foreground))]/60">Enter your card details when you book.</p></div><div className="grid size-11 place-items-center rounded-xl bg-[hsl(var(--primary-foreground))]/10"><CreditCard className="size-5 text-[hsl(var(--chart-3))]" /></div></div><div className="mt-9 flex items-center justify-between border-t border-[hsl(var(--primary-foreground))]/15 pt-4"><span className="font-mono text-xs tracking-widest text-[hsl(var(--primary-foreground))]/60">SECURE CHECKOUT</span><BadgeCheck className="size-5 text-[hsl(var(--chart-3))]" /></div></section><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Promotional credit</p><p className="mt-2 font-display text-4xl font-extrabold text-[hsl(var(--primary))]" data-testid="text-credit-balance">$0.00</p></div><WalletCards className="size-6 text-[hsl(var(--primary))]" /></div><p className="mt-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Credits will appear here when they’re available.</p><button onClick={() => alert('Promo code entry is ready for a code.')} className="mt-5 text-sm font-bold text-[hsl(var(--accent))] underline underline-offset-4" data-testid="button-promo-code">Have a promo code?</button></section></div><section className="mt-8"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl font-bold text-[hsl(var(--primary))]">Receipts</h2><Link href="/orders" className="text-sm font-bold text-[hsl(var(--accent))]" data-testid="link-wallet-orders">View deliveries</Link></div><EmptyState title="Your receipts will appear here." message="Completed deliveries include a receipt." /></section></div></AppShell>;
}

export function ProfilePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const summary = useGetDeliverySummary({ query: { queryKey: getGetDeliverySummaryQueryKey() } });
  const notifications = useListNotifications({ query: { queryKey: getListNotificationsQueryKey() } });
  const name = summary.data?.customerName || 'Your account';
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const signOut = async () => { await fetch(apiUrl('/api/auth/signout'), { method: 'POST', credentials: 'include' }).catch(() => undefined); clearBookingRouteDraft(sessionStorage); await queryClient.invalidateQueries({ queryKey: ['customer-auth-session'] }); setLocation('/welcome'); };
  return (
    <AppShell>
      <div className="animate-enter">
        <SectionHeading eyebrow="Account" title="Your account." description="Keep your delivery details handy." />
        <div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]">
          <section className="rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))] shadow-soft sm:p-8">
            <div className="grid size-16 place-items-center rounded-2xl bg-[hsl(var(--accent))] font-display text-2xl font-extrabold">{initials || 'AA'}</div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--chart-3))]">Customer profile</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.05em]">{name}</h2>
             <p className="mt-1 text-sm text-[hsl(var(--primary-foreground))]/60">Ready when you are.</p>
             <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary-foreground))]/75"><BadgeCheck className="size-4 text-[hsl(var(--chart-3))]" /> Account protected</div>
            <button onClick={signOut} className="mt-8 w-full rounded-xl border border-[hsl(var(--primary-foreground))]/20 px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary-foreground))]/10" data-testid="button-logout">Log out</button>
          </section>
          <div className="space-y-5">
            <SavedAddressesSection />
            <section className="grid gap-3 sm:grid-cols-2">
              <Link href="/wallet" className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 transition-all hover:-translate-y-0.5 hover:shadow-lift" data-testid="link-profile-wallet"><WalletCards className="size-5 text-[hsl(var(--accent))]" /><h3 className="mt-4 font-display text-lg font-bold text-[hsl(var(--primary))]">Payment methods</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Wallet and receipts.</p></Link>
              <Link href="/support" className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 transition-all hover:-translate-y-0.5 hover:shadow-lift" data-testid="link-profile-help"><CircleHelp className="size-5 text-[hsl(var(--accent))]" /><h3 className="mt-4 font-display text-lg font-bold text-[hsl(var(--primary))]">Help & safety</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Support, safety, and alerts.</p></Link>
               <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><MessageSquare className="size-5 text-[hsl(var(--accent))]" /><h3 className="mt-4 font-display text-lg font-bold text-[hsl(var(--primary))]">Notifications</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Delivery and safety updates.</p>{notifications.isLoading ? <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Loading updates…</p> : notifications.isError ? <button type="button" onClick={() => notifications.refetch()} className="mt-3 text-xs font-bold text-[hsl(var(--accent))]">Try again</button> : <div className="mt-3 space-y-2">{notifications.data?.slice(0, 2).map((notification) => <button key={notification.id} type="button" onClick={() => notification.supportSource === 'customer_ticket' && notification.supportId ? setLocation(`/support?ticket=${encodeURIComponent(notification.supportId)}`) : alert('Notification preferences will be available with your verified account.')} className="w-full rounded-lg bg-[hsl(var(--secondary))] p-2 text-left text-xs text-[hsl(var(--primary))]"><span className="block font-bold">{notification.title}</span><span className="mt-1 block line-clamp-2 text-[hsl(var(--muted-foreground))]">{notification.body}</span></button>)}</div>}</section>
              <Link href="/support#terms-safety" className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 transition-all hover:-translate-y-0.5 hover:shadow-lift" data-testid="link-profile-terms-safety"><ShieldCheck className="size-5 text-[hsl(var(--accent))]" /><h3 className="mt-4 font-display text-lg font-bold text-[hsl(var(--primary))]">Terms & safety</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Review what cannot be sent.</p></Link>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const emptySavedAddress: SavedAddressInput = { label: 'Home', fullAddress: '', street: null, city: null, state: null, postalCode: null, country: null, latitude: null, longitude: null, instructions: null, isDefault: false };

function SavedAddressesSection() {
  const queryClient = useQueryClient();
  const addresses = useListCustomerAddresses({ query: { queryKey: getListCustomerAddressesQueryKey(), retry: false } });
  const createAddress = useCreateCustomerAddress();
  const updateAddress = useUpdateCustomerAddress();
  const deleteAddress = useDeleteCustomerAddress();
  const [draft, setDraft] = useState<SavedAddressInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const isSaving = createAddress.isPending || updateAddress.isPending;
  const reset = () => { setDraft(null); setEditingId(null); setError(''); };
  const save = async () => {
    if (!draft) return;
    if (draft.fullAddress.trim().length < 3) { setError('Enter a full address, or select one from the suggestions.'); return; }
    setError('');
    try {
      if (editingId) await updateAddress.mutateAsync({ id: editingId, data: draft });
      else await createAddress.mutateAsync({ data: draft });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListCustomerAddressesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDeliverySummaryQueryKey() }),
      ]);
      reset();
    } catch {
      setError('We could not save that address. Please try again.');
    }
  };
  const selectSuggestion = (suggestion: AddressSuggestion) => setDraft((current) => current ? {
    ...current,
    fullAddress: suggestion.address,
    street: suggestion.street ?? null,
    city: suggestion.city ?? null,
    state: suggestion.state ?? null,
    postalCode: suggestion.postalCode ?? null,
    country: suggestion.country ?? null,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
  } : current);
  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Saved addresses</p><h2 className="mt-1 font-display text-2xl font-bold text-[hsl(var(--primary))]">Your regular stops</h2></div>
        {!draft && <button type="button" onClick={() => setDraft({ ...emptySavedAddress })} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-4 text-sm font-bold text-[hsl(var(--primary))]" data-testid="button-add-place"><Plus className="size-4" /> Add</button>}
      </div>
      {addresses.isLoading ? <div className="mt-5 h-20 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /> : addresses.isError ? <div className="mt-5"><ErrorState title="Saved addresses are unavailable" onRetry={() => addresses.refetch()} /></div> : addresses.data?.length ? <div className="mt-5 space-y-2">{addresses.data.map((address) => <div key={address.id} className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] p-3.5"><MapPin className="mt-1 size-4 shrink-0 text-[hsl(var(--accent))]" /><div className="min-w-0 flex-1"><p className="text-sm font-bold text-[hsl(var(--primary))]">{address.label}{address.isDefault ? ' · Default' : ''}</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{address.fullAddress}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => { setEditingId(address.id); setDraft({ label: address.label as SavedAddressInput['label'], fullAddress: address.fullAddress, street: address.street, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, latitude: address.latitude, longitude: address.longitude, instructions: address.instructions, isDefault: address.isDefault }); }} className="min-h-10 rounded-lg px-2 text-xs font-bold text-[hsl(var(--accent))]" data-testid={`button-edit-address-${address.id}`}>Edit</button><button type="button" onClick={() => { if (window.confirm(`Delete ${address.label}?`)) void deleteAddress.mutateAsync({ id: address.id }).then(() => queryClient.invalidateQueries({ queryKey: getListCustomerAddressesQueryKey() })).then(() => queryClient.invalidateQueries({ queryKey: getGetDeliverySummaryQueryKey() })); }} disabled={deleteAddress.isPending} className="min-h-10 rounded-lg px-2 text-xs font-bold text-[hsl(var(--destructive))]" data-testid={`button-delete-address-${address.id}`}>Delete</button></div></div>)}</div> : <p className="mt-5 rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]">No saved addresses yet. Add your home, work, or another regular stop for quicker booking.</p>}
      {draft && <div className="mt-5 border-t border-dashed border-[hsl(var(--border))] pt-5"><div className="flex items-center justify-between"><h3 className="font-display text-lg font-bold text-[hsl(var(--primary))]">{editingId ? 'Edit saved address' : 'Add a saved address'}</h3><button type="button" onClick={reset} className="min-h-10 px-2 text-sm font-bold text-[hsl(var(--muted-foreground))]">Cancel</button></div><div className="mt-4 space-y-4"><div className="grid grid-cols-3 gap-2">{(['Home', 'Work', 'Other'] as const).map((label) => <button type="button" key={label} onClick={() => setDraft({ ...draft, label })} className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${draft.label === label ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'}`}>{label}</button>)}</div><AddressSearchField label="Address" value={draft.fullAddress} onChange={(fullAddress) => setDraft({ ...draft, fullAddress, street: null, city: null, state: null, postalCode: null, country: null, latitude: null, longitude: null })} onSelect={selectSuggestion} placeholder="Search or enter a full address" icon={<MapPin className="size-4" />} testId="input-saved-address" /><Field label="Delivery notes (optional)" value={draft.instructions ?? ''} onChange={(instructions) => setDraft({ ...draft, instructions: instructions || null })} placeholder="Apartment, gate, or parking details" testId="input-saved-address-instructions" /><label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-[hsl(var(--primary))]"><input type="checkbox" checked={Boolean(draft.isDefault)} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} className="size-4 accent-[hsl(var(--accent))]" /> Make this my default address</label>{error && <p className="rounded-xl bg-[hsl(var(--accent))]/10 p-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{error}</p>}<PrimaryButton type="button" disabled={isSaving} onClick={() => void save()} className="w-full" data-testid="button-save-address">{isSaving ? 'Saving address…' : editingId ? 'Save changes' : 'Save address'}</PrimaryButton></div></div>}
    </section>
  );
}

export function SupportPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const ticket = useCreateSupportTicket();
  const [category, setCategory] = useState('Delivery question');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [replyError, setReplyError] = useState('');
  const tickets = useListCustomerSupportTickets({
    query: { queryKey: getListCustomerSupportTicketsQueryKey() },
  });
  const ticketId = new URLSearchParams(search).get('ticket');
  const orderedTickets = useMemo(
    () => [...(tickets.data ?? [])].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()),
    [tickets.data],
  );
  const selectedTicket = orderedTickets.find((item) => item.id === ticketId);
  const conversation = useListCustomerSupportTicketConversation(selectedTicket?.id ?? 'missing', {
    query: {
      enabled: Boolean(selectedTicket),
      queryKey: getListCustomerSupportTicketConversationQueryKey(selectedTicket?.id ?? 'missing'),
    },
  });
  const replyMutation = useCreateCustomerSupportTicketConversationReply();
  const selectTicket = (id: string) => setLocation(`/support?ticket=${encodeURIComponent(id)}`);
  const submit = () => {
    if (message.trim().length < 5) return;
    setSubmitError('');
    ticket.mutate({ data: { category, message: message.trim() } }, {
      onSuccess: (result) => {
        setMessage('');
        void queryClient.invalidateQueries({ queryKey: getListCustomerSupportTicketsQueryKey() });
        selectTicket(result.id);
      },
      onError: () => setSubmitError('We could not send that just now. Please try again.'),
    });
  };
  const sendReply = () => {
    if (!selectedTicket || reply.trim().length < 2) return;
    setReplyError('');
    replyMutation.mutate({ id: selectedTicket.id, data: { body: reply.trim() } }, {
      onSuccess: () => {
        setReply('');
        void conversation.refetch();
        void queryClient.invalidateQueries({ queryKey: getListCustomerSupportTicketsQueryKey() });
      },
      onError: () => setReplyError('We could not send your reply. Please try again.'),
    });
  };
  return <AppShell><div className="mx-auto max-w-6xl animate-enter"><SectionHeading eyebrow="Support" title="How can we help?" description="Send a message, then follow every support conversation here." /><div className="grid gap-5 xl:grid-cols-[minmax(260px,.7fr)_minmax(0,1.3fr)]"><aside className="space-y-4"><div className="rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))]"><Headphones className="size-6 text-[hsl(var(--chart-3))]" /><h2 className="mt-4 font-display text-xl font-bold">Your support history</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--primary-foreground))]/65">Choose a request to read or reply.</p></div><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3" aria-label="Your support tickets">{tickets.isLoading ? <LoadingState label="Loading support history" /> : tickets.isError ? <ErrorState title="Support history is unavailable" onRetry={() => tickets.refetch()} /> : orderedTickets.length === 0 ? <EmptyState title="No support requests yet." message="When you contact us, your conversation will appear here." /> : <div className="max-h-[45dvh] space-y-2 overflow-y-auto">{orderedTickets.map((item) => <button key={item.id} type="button" onClick={() => selectTicket(item.id)} aria-pressed={selectedTicket?.id === item.id} className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedTicket?.id === item.id ? 'border-[hsl(var(--accent))] bg-[hsl(var(--secondary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))]'}`} data-testid={`button-support-ticket-${item.id}`}><div className="flex items-start justify-between gap-2"><span className="text-sm font-bold text-[hsl(var(--primary))]">{item.category}</span><span className="shrink-0 text-[11px] font-bold uppercase text-[hsl(var(--muted-foreground))]">{statusLabel(item.status)}</span></div>{item.lastConversationPreview && <p className="mt-1 line-clamp-2 text-sm leading-5 text-[hsl(var(--muted-foreground))]">{item.lastConversationPreview.body}</p>}<p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{dateLabel(item.updatedAt || item.createdAt)}</p></button>)}</div>}</section></aside><div className="space-y-5"><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft sm:p-7"><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">New message</p><h2 className="mt-2 font-display text-2xl font-bold text-[hsl(var(--primary))]">Tell us what happened.</h2><label className="mt-6 block"><span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Topic</span><select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary))] outline-none focus:border-[hsl(var(--accent))]" data-testid="select-support-category"><option>Delivery question</option><option>Payment question</option><option>Report a driver</option><option>Something else</option></select></label><label className="mt-4 block"><span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Message</span><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={2000} placeholder="Share your order number and what you need." className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm leading-6 text-[hsl(var(--primary))] outline-none placeholder:text-[hsl(var(--muted-foreground))]/70 focus:border-[hsl(var(--accent))]" data-testid="textarea-support-message" /></label>{submitError && <p className="mt-4 rounded-xl bg-[hsl(var(--accent))]/10 p-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{submitError}</p>}<PrimaryButton onClick={submit} disabled={ticket.isPending || message.trim().length < 5} className="mt-5 w-full" data-testid="button-submit-support">{ticket.isPending ? 'Sending…' : 'Send message'} <ArrowRight className="size-4" /></PrimaryButton><p className="mt-3 text-center text-xs text-[hsl(var(--muted-foreground))]">Please don’t include passwords or full card numbers.</p></section>{selectedTicket && <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft sm:p-7" aria-labelledby="support-conversation-heading"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Conversation</p><h2 id="support-conversation-heading" className="mt-1 font-display text-2xl font-bold text-[hsl(var(--primary))]">{selectedTicket.category}</h2></div><span className="rounded-full bg-[hsl(var(--secondary))] px-3 py-1 text-xs font-bold text-[hsl(var(--primary))]">{statusLabel(selectedTicket.status)}</span></div><div className="mt-5 max-h-[50dvh] space-y-3 overflow-y-auto">{conversation.isLoading ? <LoadingState label="Loading conversation" /> : conversation.isError ? <ErrorState title="Conversation is unavailable" onRetry={() => conversation.refetch()} /> : conversation.data?.length ? conversation.data.map((entry) => <div key={entry.id} className={`rounded-xl p-3 text-sm ${entry.author.role === 'staff' ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]' : 'border border-[hsl(var(--border))] text-[hsl(var(--primary))]'}`}><p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">{entry.author.role === 'staff' ? 'Support' : 'You'} · {dateLabel(entry.createdAt)}</p><p className="mt-1 whitespace-pre-wrap leading-6">{entry.body}</p></div>) : <EmptyState title="No messages yet." message="Your conversation will appear here when there is an update." />}</div><label className="mt-5 block"><span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Reply</span><textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={3} maxLength={2000} placeholder="Write a reply…" className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm leading-6 text-[hsl(var(--primary))] outline-none focus:border-[hsl(var(--accent))]" data-testid="textarea-support-reply" /></label>{replyError && <p className="mt-3 rounded-xl bg-[hsl(var(--accent))]/10 p-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{replyError}</p>}<PrimaryButton onClick={sendReply} disabled={replyMutation.isPending || reply.trim().length < 2} className="mt-3 w-full" data-testid="button-submit-support-reply">{replyMutation.isPending ? 'Sending reply…' : 'Send reply'} <Send className="size-4" /></PrimaryButton></section>}{ticketId && !tickets.isLoading && !selectedTicket && <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><p className="text-sm text-[hsl(var(--muted-foreground))]">That support request is unavailable. Choose one from your history.</p></section>}</div></div><TermsSafetyPolicy /></div></AppShell>;
}

function TermsSafetyPolicy() {
  return <section id="terms-safety" className="aa-prohibited mt-8 rounded-2xl p-5 sm:p-7" data-testid="section-terms-safety"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[hsl(var(--destructive))]" /><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--destructive))]">Terms & safety</p><h2 className="mt-2 font-display text-2xl font-bold text-[hsl(var(--primary))]">Prohibited-items policy</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Anything Anywhere does not accept the following items for delivery:</p><ul className="mt-4 grid gap-2 text-sm font-semibold text-[hsl(var(--primary))] sm:grid-cols-2">{PROHIBITED_ITEMS.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[hsl(var(--destructive))]" />{item}</li>)}</ul><p className="mt-5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">When you book, you must confirm that your package does not contain any prohibited items. Policy version {PROHIBITED_ITEMS_POLICY_VERSION}.</p></div></div></section>;
}

const ariQuickReplies = {
  'Where is my package?': 'Open any active delivery to see its latest route status, assigned driver, and timeline.',
  'Change delivery instructions': 'If a driver has not started the handoff, send the delivery desk a support request with your order number and the updated instruction.',
  'Contact support': 'For a delivery issue or an account question, our delivery team can help right away through the support form.',
  'What can I send?': 'Everyday parcels, documents, gifts, groceries, flowers, and small electronics are great fits. We cannot carry prohibited, hazardous, illegal, or age-restricted items.',
  'Explain my price': 'Your quote reflects the route, package details, timing, and tax. There is never a tip line.',
  'Cancel delivery': 'Cancellation is available before a driver accepts the delivery. Contact the desk to confirm the current cancellation option for your order.',
  'Report a problem': 'Use the support form with the delivery number and what happened. The delivery team will review it with you.',
} as const;

export function AriPage() {
  const [, setLocation] = useLocation();
  const [selected, setSelected] = useState<keyof typeof ariQuickReplies | null>(null);
  const [message, setMessage] = useState('');
  const reply = selected ? ariQuickReplies[selected] : '';
  const send = () => {
    if (message.trim().length > 0) {
      setSelected(null);
      setMessage('');
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl animate-enter">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" data-testid="link-ari-back">
          <ArrowLeft className="size-4" /> Back home
        </Link>
        <section className="overflow-hidden rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-lift">
          <div className="relative px-6 py-7 sm:px-9 sm:py-9">
            <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full border-[18px] border-[hsl(var(--accent))]/70" />
            <p className="relative text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--chart-3))]">Delivery assistant</p>
            <div className="relative mt-3 flex items-end justify-between gap-5">
              <div>
                <h1 className="font-display text-4xl font-extrabold tracking-[-.06em] sm:text-5xl">Ask Ari.</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[hsl(var(--primary-foreground))]/70">Helpful answers for booking, tracking, and sending a package anywhere.</p>
              </div>
              <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--primary))] shadow-lift">
                <Package className="size-8" strokeWidth={1.7} />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft sm:p-7">
          <div className="flex items-end gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--primary))]">
              <Package className="size-5" />
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-[hsl(var(--secondary))] px-4 py-3 text-sm leading-6 text-[hsl(var(--primary))]">
              Hi, I’m Ari. I can point you to the right delivery step, explain what can travel with us, or connect you with the delivery team.
            </div>
          </div>
          {selected && (
            <>
              <div className="mt-5 flex items-end justify-end gap-3">
                <p className="max-w-[75%] rounded-2xl rounded-br-md bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))]">{selected}</p>
              </div>
              <div className="mt-4 flex items-end gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"><Package className="size-5" /></div>
                <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-[hsl(var(--secondary))] px-4 py-3 text-sm leading-6 text-[hsl(var(--primary))]" data-testid="ari-reply">{reply}</p>
              </div>
            </>
          )}
          <div className="mt-7 flex flex-wrap gap-2">
            {(Object.keys(ariQuickReplies) as Array<keyof typeof ariQuickReplies>).map((question) => (
              <button key={question} onClick={() => setSelected(question)} className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3.5 py-2.5 text-xs font-bold text-[hsl(var(--primary))] transition-colors hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10" data-testid={`button-ari-${question.slice(0, 5).toLowerCase().replaceAll(' ', '-')}`}>
                {question}
              </button>
            ))}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); send(); }} className="mt-6 flex gap-2 border-t border-dashed border-[hsl(var(--border))] pt-5">
            <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask a delivery question…" className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm text-[hsl(var(--primary))] outline-none placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--accent))]" data-testid="input-ari-message" />
            <button type="submit" disabled={!message.trim()} className="grid size-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] transition-transform hover:-translate-y-0.5 disabled:opacity-40" aria-label="Send question to Ari" data-testid="button-ari-send">
              <Send className="size-4" />
            </button>
          </form>
          {message === '' && !selected && <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">For account-specific changes or an urgent delivery issue, connect directly with the support team.</p>}
        </section>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link href="/book" className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 transition-transform hover:-translate-y-0.5 hover:shadow-lift" data-testid="link-ari-book">
            <Package className="size-5 text-[hsl(var(--accent))]" />
            <h2 className="mt-3 font-display text-xl font-bold text-[hsl(var(--primary))]">Start a delivery</h2>
            <p className="mt-1 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Build a delivery request and get an upfront quote.</p>
          </Link>
          <button onClick={() => setLocation('/support')} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-5 text-left transition-transform hover:-translate-y-0.5 hover:shadow-lift" data-testid="button-ari-support">
            <MessageSquare className="size-5 text-[hsl(var(--accent))]" />
            <h2 className="mt-3 font-display text-xl font-bold text-[hsl(var(--primary))]">Talk to the desk</h2>
            <p className="mt-1 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Send a real support request to the delivery team.</p>
          </button>
        </div>
      </div>
    </AppShell>
  );
}