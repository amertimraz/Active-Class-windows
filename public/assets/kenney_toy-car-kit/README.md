# Kenney Toy Car Kit Integration

This folder contains the Kenney Toy Car Kit assets that have been integrated into the Quiz Race game.

## Assets Used

### Vehicles
- `vehicle-racer.png` - Racing car
- `vehicle-speedster.png` - Speedster car
- `vehicle-drag-racer.png` - Drag racer
- `vehicle-vintage-racer.png` - Vintage racer
- `vehicle-monster-truck.png` - Monster truck

### Wheels
- `wheel-small.png` - Small wheels
- `wheel-medium.png` - Medium wheels
- `wheel-large.png` - Large wheels

### Track Elements
- `track-wide-straight.png` - Straight track pieces
- `gate-finish.png` - Finish line gate

### Decorations
- `tree.png` - Regular tree
- `tree-pine.png` - Pine tree

## Integration Details

The game now uses these assets instead of procedurally generated graphics:

1. **Cars**: Each player gets a different vehicle sprite with color tinting
2. **Background**: Track pieces and trees are added for visual appeal
3. **Finish Line**: Professional finish gate from the kit

## Fallback System

If assets fail to load, the game automatically falls back to the original cartoon-style graphics.

## Server Access

To access the game with these assets:
1. Start the server: `python -m http.server 3000`
2. Open: `http://localhost:3000/public/pages/race.html`

## Performance

- Assets are loaded asynchronously in the Phaser preload phase
- Fallback system ensures the game works even if assets are missing
- Sprites are scaled appropriately for the game canvas