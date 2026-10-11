# Style Picker Tool

The plugin should have a tool that let annotate a region of the map, and save the revelant elements in folder, that can be redeable later on by an another tool.

This tool should be called "Style-Picker".

There should be a + and - buttons, that let the user decide the brush size of the region to annotate. There should be a text box to annote the region.

There should be a button called "Save Style". When this button is clicked, it should save, in a folder that the mcp server can read:

- All the elements in that region i.e. scenery pieces, rides, etc. Make sure that the colours chosen are also store for the recolourable map of the objects, rotation, etc. 
- The information of the terrain, water, etc.
- A screenshot of that region, with all other elements on the map masked out (to determine if doable via the plugin system)
- The caption associated to that capture.

Note that the styles store can have elements overlapping, i.e., the designer can have used the Zero Clearances cheat. Make sure to not enforce the clearances.

There should be a button to clear all stored styles.

# Magic Fill Tool

The magic fill tool is a tool that let fill a region, with a selectable brush size, and a caption a region. The LLM should be able to check the styles store by the Style Picker Tool, and populate the region by following a given prompt.

This tool should be called "Magic Fill Tool".

There should be a + and - buttons, that let the user decide the brush size of the region to annotate. There should be a text box to let the user decide what to fill in that region.

When the user drags the mouse on the map with the selected brush size, the LLM should guess what elements it should place based on the styles stored, and it should check surrounding existing elements on the map to make this cohesive. Do not reinforce clearances and let the tool uses the Zero Clearances cheat.

For example, a user store many styles of forest with the Style Picker Tool. When the use finally uses the magic fill tool, it should place elements that better fit from all the styles stored, that also need to make sense.

The tool can take a screenshot of the newly placed elements, and check from the screenshots of the styles stored if it looks right...

The tool should be able to load an object that isn't in the park that the LLM want to place, that was in a stored style. For example, the user saves a style from park 1, switch to park 2, use the magic fill tool, but the objects that the LLM picked were not part of park 2, so the park 2 need to load those objects in.

If the park has exceeded the objects count limit, just warn the user with a warning box and proceed with placing the elements, but discard the ones that required that object.