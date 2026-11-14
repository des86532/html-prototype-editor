import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBlob } from './download';

describe('saveBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clicks a temporary download anchor and revokes the URL', () => {
    const create = vi.fn(() => 'blob:abc');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let download = '';
    let href = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      download = this.download;
      href = this.href;
    });
    saveBlob(new Blob(['x']), 'a.json');
    expect(create).toHaveBeenCalled();
    expect(download).toBe('a.json');
    expect(href).toBe('blob:abc');
    expect(revoke).toHaveBeenCalledWith('blob:abc');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
