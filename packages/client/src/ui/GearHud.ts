// The worn gear's panel over the item hint: what it is, how to use it, how long it lasts, and its
// tank. Hidden while nothing is worn.
import { GEAR, gearHelp, type GearState } from '@world/shared';
import { IS_TOUCH } from '../input/touch';
import { Fuel } from './Fuel';

// On touch the only held control is the jump button, which holds the jump key down.
const keyName = IS_TOUCH ? () => 'JUMP' : undefined;

export class GearHud {
  private readonly el = document.getElementById('gear')!;
  private readonly label = this.el.querySelector('.label')!;
  private readonly fuel = new Fuel(this.el.querySelector<HTMLElement>('.tank')!);
  private text = '';

  set(gear: GearState | null): void {
    const text = gear
      ? [gear.id.toUpperCase(), gearHelp(gear.id, keyName), `${Math.ceil(gear.left)}s`].join(' · ')
      : '';
    if (text !== this.text) {
      this.text = text;
      this.label.textContent = text;
      this.el.classList.toggle('hidden', !gear);
    }
    this.fuel.set(gear ? gear.fuel / GEAR[gear.id].fuelSeconds : null);
  }
}
