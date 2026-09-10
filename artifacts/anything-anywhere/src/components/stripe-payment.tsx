import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { CreditCard, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PrimaryButton } from '@/components/app-shell';

type StripePaymentProps = {
  publishableKey: string;
  clientSecret: string;
  returnUrl: string;
  onPaymentConfirmed: () => void;
  onError: (message: string) => void;
};

function PaymentForm({ returnUrl, onPaymentConfirmed, onError }: Omit<StripePaymentProps, 'publishableKey' | 'clientSecret'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!stripe || !elements) return;
    setIsSubmitting(true);
    onError('');
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    });
    setIsSubmitting(false);

    if (error) {
      onError(error.message || 'Your payment could not be confirmed. Please check the details and try again.');
      return;
    }
    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      onPaymentConfirmed();
      return;
    }
    onError('Your payment needs another step before the delivery can be confirmed.');
  };

  return (
    <div className="mt-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><CreditCard className="size-4" /></span>
        <div>
          <p className="text-sm font-bold text-[hsl(var(--primary))]">Secure payment</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Your card details are securely handled by Stripe.</p>
        </div>
      </div>
      <PaymentElement options={{ layout: 'tabs' }} />
      <PrimaryButton onClick={submit} disabled={!stripe || !elements || isSubmitting} className="mt-5 w-full justify-center" data-testid="button-pay-delivery">
        {isSubmitting ? <><LoaderCircle className="size-4 animate-spin" /> Confirming secure payment…</> : <><LockKeyhole className="size-4" /> Pay securely</>}
      </PrimaryButton>
    </div>
  );
}

export function StripePayment({ publishableKey, clientSecret, returnUrl, onPaymentConfirmed, onError }: StripePaymentProps) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
      <PaymentForm returnUrl={returnUrl} onPaymentConfirmed={onPaymentConfirmed} onError={onError} />
    </Elements>
  );
}