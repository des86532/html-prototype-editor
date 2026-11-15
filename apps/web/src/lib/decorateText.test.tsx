import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { decorateText, readableTextColor } from './decorateText';

const renderText = (text: string, names: string[] = []) =>
  render(<p>{decorateText(text, names, 'k')}</p>).container;

describe('decorateText', () => {
  it('turns hex colors into swatch chips, skipping entities and mid-word hashes', () => {
    const root = renderText('改成 #FFF 或 #c2185b，不要 &#123; 或 a#fff');
    const chips = Array.from(root.querySelectorAll<HTMLElement>('[data-color]'));
    expect(chips.map((c) => c.dataset.color)).toEqual(['#fff', '#c2185b']);
    expect(chips[1]!.style.backgroundColor).toBe('rgb(194, 24, 91)');
    expect(root.textContent).toBe('改成 #FFF 或 #c2185b，不要 &#123; 或 a#fff');
  });

  it('ignores 4–5 digit and 7+ digit hex-like runs', () => {
    expect(renderText('#abcd #abcde #abcdef0').querySelectorAll('[data-color]')).toHaveLength(0);
  });

  it('prefers the longest matching mention name', () => {
    const root = renderText('@Guest Gina 看一下', ['Guest Gina', 'Guest']);
    const m = root.querySelectorAll('[data-mention]');
    expect(m).toHaveLength(1);
    expect(m[0]!.textContent).toBe('@Guest Gina');
    expect(root.textContent).toBe('@Guest Gina 看一下');
  });

  it('only marks mentions at a token boundary and escapes regex characters in names', () => {
    expect(renderText('@Gina.', ['Gina']).querySelectorAll('[data-mention]')).toHaveLength(1);
    expect(renderText('@Ginax', ['Gina']).querySelectorAll('[data-mention]')).toHaveLength(0);
    expect(renderText('mail@Gina.io', ['Gina']).querySelectorAll('[data-mention]')).toHaveLength(0);
    expect(renderText('@a.b+c', ['a.b+c']).querySelectorAll('[data-mention]')).toHaveLength(1);
    expect(renderText('@axb', ['a.b']).querySelectorAll('[data-mention]')).toHaveLength(0);
  });
});

describe('readableTextColor', () => {
  it('uses dark text on light colors and white text on dark colors', () => {
    expect(readableTextColor('#ffffff')).toBe('#24211c');
    expect(readableTextColor('#fff')).toBe('#24211c');
    expect(readableTextColor('#c2185b')).toBe('#ffffff');
    expect(readableTextColor('#000')).toBe('#ffffff');
  });
});
