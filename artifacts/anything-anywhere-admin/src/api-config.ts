import { setBaseUrl } from '@workspace/api-client-react';
import { configuredApiOrigin } from '@/lib/api-url';

setBaseUrl(configuredApiOrigin || null);