function directChannelDisabledError() {
  const error = new Error('Downloader Bot direct channel publishing is permanently disabled. Use the filter group and Content Manager relay.');
  error.code = 'DOWNLOADER_DIRECT_CHANNEL_DISABLED';
  return error;
}

export function supportChannelTarget() {
  return '';
}

export async function publishSupportTestimonial() {
  throw directChannelDisabledError();
}

export async function publishLuahRasa() {
  throw directChannelDisabledError();
}
