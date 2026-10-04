import { getLocalStorage } from '@/lib/utilsClient';

function getCredentials(
  type: 'credentials' | 'one-time-credentials' | 'all' = 'all',
): Credentials | null {
  if (type === 'credentials') {
    return getLocalStorage<Credentials>('credentials');
  } else if (type === 'one-time-credentials') {
    return getLocalStorage<Credentials>('one-time-credentials');
  }
  return (
    getLocalStorage<Credentials>('credentials') ||
    getLocalStorage<Credentials>('one-time-credentials') ||
    null
  );
}

export default getCredentials;
