import { MapPin, RotateCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type AddressSuggestion, getListAddressSuggestionsQueryKey, useListAddressSuggestions } from '@workspace/api-client-react';

type AddressSearchFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  placeholder: string;
  icon?: ReactNode;
  testId: string;
};

export function AddressSearchField({ label, value, onChange, onSelect, placeholder, icon, testId }: AddressSearchFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const query = value.trim();
  const params = { q: query, limit: 5 };
  const search = useListAddressSuggestions(params, {
    query: {
      queryKey: getListAddressSuggestionsQueryKey(params),
      enabled: query.length >= 3,
      retry: false,
      staleTime: 30_000,
    },
  });
  const suggestions = search.data?.suggestions ?? [];
  const showResults = isOpen && query.length >= 3;

  return (
    <label className="relative block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="relative block">
        {icon && <span className="pointer-events-none absolute left-3.5 top-4 text-[hsl(var(--muted-foreground))]">{icon}</span>}
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 pl-10 text-sm font-medium text-[hsl(var(--primary))] outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground))]/70 focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent))]/10"
          data-testid={testId}
        />
      </span>
      {showResults && (
        <div className="mt-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-soft" role="listbox" aria-label={`${label} suggestions`}>
          <div className="flex items-center justify-between gap-3 px-2 pb-1 text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
            <span>{search.data?.providerStatus === 'available' ? 'Verified address matches' : 'Saved address matches'}</span>
            {search.isFetching && <span>Searching…</span>}
          </div>
          {search.isError ? (
            <div className="flex items-start gap-2 rounded-lg bg-[hsl(var(--accent))]/10 px-2 py-2 text-xs leading-5 text-[hsl(var(--destructive))]" data-testid={`${testId}-error`}>
              <span className="flex-1">Address search is temporarily unavailable. You can enter the full address or use a saved place.</span>
              <button type="button" onClick={() => void search.refetch()} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--card))] px-2.5 font-bold text-[hsl(var(--primary))]" data-testid={`${testId}-retry`}>
                <RotateCw className="size-3" /> Retry
              </button>
            </div>
          ) : suggestions.length ? (
            suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                role="option"
                onClick={() => {
                  onSelect(suggestion);
                  setIsOpen(false);
                }}
                className="block min-h-11 w-full rounded-lg px-2 py-2 text-left text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))]"
                data-testid={`${testId}-suggestion-${suggestion.id}`}
              >
                <MapPin className="mr-2 inline size-3.5 text-[hsl(var(--accent))]" />{suggestion.label}
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid={`${testId}-message`}>
              {search.data?.message || (search.isLoading ? 'Searching addresses…' : 'No verified addresses found. Keep typing or enter the full address.')}
            </p>
          )}
        </div>
      )}
    </label>
  );
}