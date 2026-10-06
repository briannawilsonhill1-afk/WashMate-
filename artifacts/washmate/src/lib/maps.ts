export function isIosLikePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (
    navigator.platform === 'MacIntel' &&
    typeof (navigator as any).maxTouchPoints === 'number' &&
    (navigator as any).maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

export function getDirectionsUrl(address: string): string {
  const dest = encodeURIComponent(address);
  if (isIosLikePlatform()) {
    return `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

export function getMapPreviewUrl(area: string): string {
  const q = encodeURIComponent(area);
  if (isIosLikePlatform()) {
    return `https://maps.apple.com/?q=${q}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function openDirections(address: string): void {
  if (typeof window === 'undefined') return;
  window.open(getDirectionsUrl(address), '_blank', 'noopener,noreferrer');
}
