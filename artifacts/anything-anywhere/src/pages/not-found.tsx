import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[hsl(var(--background))] p-5">
      <Card className="w-full max-w-md rounded-3xl border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft">
        <CardContent className="p-7 text-center sm:p-9">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[hsl(var(--secondary))]">
            <AlertCircle className="size-5 text-[hsl(var(--primary))]" />
          </div>
          <h1 className="font-display text-2xl font-bold text-[hsl(var(--primary))]">That page isn’t here.</h1>
          <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Let’s get you back to your deliveries.</p>
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]">Back home</Link>
        </CardContent>
      </Card>
    </div>
  );
}
