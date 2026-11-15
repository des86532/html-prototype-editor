import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

const s = () => useUiStore.getState();

beforeEach(() => s().reset());

describe('uiStore', () => {
  it('defaults: interact mode, rect tool, markups shown, resolved hidden, panel collapsed', () => {
    expect(s()).toMatchObject({
      mode: 'interact',
      tool: 'rect',
      color: '#e5484d',
      stroke: 4,
      showMarkups: true,
      showResolved: false,
      panelOpen: false,
      selectedId: null,
    });
  });

  it('select keeps a single selection; leaving markup mode keeps it', () => {
    s().setMode('markup');
    s().select('a');
    s().select('b');
    expect(s().selectedId).toBe('b');
    s().toggleMode();
    expect(s()).toMatchObject({ mode: 'interact', selectedId: 'b' });
  });

  it('hiding markups returns to interact mode and clears the selection', () => {
    s().setMode('markup');
    s().select('a');
    s().setShowMarkups(false);
    expect(s()).toMatchObject({ showMarkups: false, mode: 'interact', selectedId: null });
    s().setShowMarkups(true);
    expect(s().showMarkups).toBe(true);
    s().setMode('markup');
    s().select('a');
    s().toggleShowMarkups();
    expect(s()).toMatchObject({ showMarkups: false, mode: 'interact', selectedId: null });
    s().toggleShowMarkups();
    expect(s().showMarkups).toBe(true);
  });

  it('reset restores tool, color and stroke', () => {
    s().setTool('pen');
    s().setColor('#0091ff');
    s().setStroke(8);
    s().reset();
    expect(s()).toMatchObject({ tool: 'rect', color: '#e5484d', stroke: 4 });
  });
});

describe('toolbarCollapsed', () => {
  afterEach(() => s().setToolbarCollapsed(false));

  it('persists to localStorage and survives reset()', () => {
    s().setToolbarCollapsed(true);
    expect(localStorage.getItem('hpe.viewer.toolbarCollapsed')).toBe('1');
    s().reset();
    expect(s().toolbarCollapsed).toBe(true);
    s().setToolbarCollapsed(false);
    expect(localStorage.getItem('hpe.viewer.toolbarCollapsed')).toBe('0');
  });
});
