import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDriverProfileQueryKey,
  useGetDriverProfile,
  type DriverProfile,
} from '@workspace/api-client-react';
import { apiUrl } from '@/lib/api-url';

type DriverProfileQuery = ReturnType<typeof useGetDriverProfile<DriverProfile>>;
type DriverSessionValue = DriverProfileQuery & {
  establishSession: (profile: DriverProfile) => void;
  clearSession: () => void;
  signOut: () => Promise<void>;
};

const DriverSessionContext = createContext<DriverSessionValue | null>(null);

export function DriverSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const profileQuery = useGetDriverProfile<DriverProfile>({
    query: {
      queryKey: getGetDriverProfileQueryKey(),
      enabled: !signedOut,
      retry: false,
      retryOnMount: false,
      refetchInterval: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  const establishSession = useCallback((profile: DriverProfile) => {
    queryClient.setQueryData(getGetDriverProfileQueryKey(), profile);
    setSignedOut(false);
  }, [queryClient]);
  const clearSession = useCallback(() => {
    setSignedOut(true);
    queryClient.removeQueries({ queryKey: getGetDriverProfileQueryKey(), exact: true });
  }, [queryClient]);
  const signOut = useCallback(async () => {
    const response = await fetch(apiUrl('/api/auth/signout'), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('We could not sign you out. Please try again.');
    }
    setSignedOut(true);
    queryClient.clear();
  }, [queryClient]);
  const session = {
    ...profileQuery,
    data: signedOut ? undefined : profileQuery.data,
    isLoading: signedOut ? false : profileQuery.isLoading,
    isError: signedOut ? false : profileQuery.isError,
    error: signedOut ? null : profileQuery.error,
    establishSession,
    clearSession,
    signOut,
  } as DriverSessionValue;

  return (
    <DriverSessionContext.Provider value={session}>
      {children}
    </DriverSessionContext.Provider>
  );
}

export function useDriverSession() {
  const session = useContext(DriverSessionContext);
  if (!session) {
    throw new Error('useDriverSession must be used inside DriverSessionProvider.');
  }
  return session;
}