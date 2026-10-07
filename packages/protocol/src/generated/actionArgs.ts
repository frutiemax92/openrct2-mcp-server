// Fichier généré par tools/gen-tables.mjs à partir de ~/Documents/OpenRCT2. Ne pas modifier à la main.
/**
 * Clés lues par AcceptParameters (toutes obligatoires, sauf `flags`). Le C++ fait foi (SPEC F6).
 * Suffixe `:bool` / `:string` : le jeu exige ce type JS exact ; sinon un nombre.
 */
export const ACTION_ARGS: Readonly<Record<string, readonly string[]>> = {
    "balloonpress": [
        "id"
    ],
    "bannerplace": [
        "x",
        "y",
        "z",
        "direction",
        "object",
        "primaryColour"
    ],
    "bannerremove": [
        "x",
        "y",
        "z",
        "direction"
    ],
    "bannersetcolour": [
        "x",
        "y",
        "z",
        "direction",
        "primaryColour"
    ],
    "bannersetname": [
        "id",
        "name:string"
    ],
    "bannersetstyle": [
        "id",
        "type",
        "parameter"
    ],
    "cheatset": [
        "type",
        "param1",
        "param2"
    ],
    "clearscenery": [
        "x1",
        "y1",
        "x2",
        "y2",
        "itemsToClear"
    ],
    "footpathadditionplace": [
        "x",
        "y",
        "z",
        "object"
    ],
    "footpathadditionremove": [
        "x",
        "y",
        "z"
    ],
    "footpathlayoutplace": [
        "x",
        "y",
        "z",
        "slopeType",
        "slopeDirection",
        "object",
        "railingsObject",
        "edges",
        "constructFlags"
    ],
    "footpathplace": [
        "x",
        "y",
        "z",
        "object",
        "railingsObject",
        "direction",
        "slopeType",
        "slopeDirection",
        "constructFlags"
    ],
    "footpathremove": [
        "x",
        "y",
        "z"
    ],
    "gamesetspeed": [
        "speed"
    ],
    "guestsetflags": [
        "peep",
        "guestFlags"
    ],
    "guestsetname": [
        "peep",
        "name:string"
    ],
    "landbuyrights": [
        "x1",
        "y1",
        "x2",
        "y2",
        "setting"
    ],
    "landlower": [
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "selectionType"
    ],
    "landraise": [
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "selectionType"
    ],
    "landsetheight": [
        "x",
        "y",
        "height",
        "style"
    ],
    "landsetrights": [
        "x1",
        "y1",
        "x2",
        "y2",
        "setting",
        "ownership"
    ],
    "landsmooth": [
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "selectionType",
        "isLowering:bool"
    ],
    "largesceneryplace": [
        "x",
        "y",
        "z",
        "direction",
        "object",
        "primaryColour",
        "secondaryColour",
        "tertiaryColour"
    ],
    "largesceneryremove": [
        "x",
        "y",
        "z",
        "direction",
        "tileIndex"
    ],
    "largescenerysetcolour": [
        "x",
        "y",
        "z",
        "direction",
        "tileIndex",
        "primaryColour",
        "secondaryColour",
        "tertiaryColour"
    ],
    "loadorquit": [
        "mode",
        "savePromptMode"
    ],
    "mapchangesize": [
        "targetSizeX",
        "targetSizeY",
        "shiftX",
        "shiftY"
    ],
    "mazeplacetrack": [
        "x",
        "y",
        "z",
        "ride",
        "mazeEntry"
    ],
    "mazesettrack": [
        "x",
        "y",
        "z",
        "direction",
        "ride",
        "mode",
        "isInitialPlacement:bool"
    ],
    "networkmodifygroup": [
        "type",
        "groupId",
        "name:string",
        "permissionIndex",
        "permissionState"
    ],
    "parkentranceplace": [
        "x",
        "y",
        "z",
        "direction",
        "footpathSurfaceObject",
        "entranceObject",
        "footpathTypeIsLegacy:bool"
    ],
    "parkentranceremove": [
        "x",
        "y",
        "z"
    ],
    "parkmarketing": [
        "type",
        "item",
        "duration"
    ],
    "parksetdate": [
        "year",
        "month",
        "day"
    ],
    "parksetentrancefee": [
        "value"
    ],
    "parksetloan": [
        "value"
    ],
    "parksetname": [
        "name:string"
    ],
    "parksetparameter": [
        "parameter",
        "value"
    ],
    "parksetresearchfunding": [
        "priorities",
        "fundingAmount"
    ],
    "pausetoggle": [],
    "peeppickup": [
        "type",
        "id",
        "x",
        "y",
        "z",
        "playerId"
    ],
    "peepspawnplace": [
        "x",
        "y",
        "z",
        "direction"
    ],
    "playerkick": [
        "playerId"
    ],
    "playersetgroup": [
        "playerId",
        "groupId"
    ],
    "ridecreate": [
        "rideType",
        "rideObject",
        "entranceObject",
        "colour1",
        "colour2",
        "inspectionInterval"
    ],
    "ridedemolish": [
        "ride",
        "modifyType"
    ],
    "rideentranceexitplace": [
        "x",
        "y",
        "direction",
        "ride",
        "station",
        "isExit:bool"
    ],
    "rideentranceexitremove": [
        "x",
        "y",
        "ride",
        "station",
        "isExit:bool"
    ],
    "ridefreezerating": [
        "ride",
        "type",
        "value"
    ],
    "ridesetappearance": [
        "ride",
        "type",
        "value",
        "index"
    ],
    "ridesetcolourscheme": [
        "x",
        "y",
        "z",
        "direction",
        "trackType",
        "colourScheme"
    ],
    "ridesetname": [
        "ride",
        "name:string"
    ],
    "ridesetprice": [
        "ride",
        "price",
        "isPrimaryPrice:bool"
    ],
    "ridesetsetting": [
        "ride",
        "setting",
        "value"
    ],
    "ridesetstatus": [
        "ride",
        "status"
    ],
    "ridesetvehicle": [
        "ride",
        "type",
        "value",
        "colour"
    ],
    "scenariosetsetting": [
        "setting",
        "value"
    ],
    "signsetname": [
        "id",
        "name:string"
    ],
    "signsetstyle": [
        "id",
        "mainColour",
        "textColour",
        "isLarge:bool"
    ],
    "smallsceneryplace": [
        "x",
        "y",
        "z",
        "direction",
        "quadrant",
        "object",
        "primaryColour",
        "secondaryColour",
        "tertiaryColour"
    ],
    "smallsceneryremove": [
        "x",
        "y",
        "z",
        "object",
        "quadrant"
    ],
    "smallscenerysetcolour": [
        "x",
        "y",
        "z",
        "quadrant",
        "sceneryType",
        "primaryColour",
        "secondaryColour",
        "tertiaryColour"
    ],
    "stafffire": [
        "id"
    ],
    "staffhire": [
        "autoPosition:bool",
        "staffType",
        "costumeIndex",
        "staffOrders"
    ],
    "staffsetcolour": [
        "staffType",
        "colour"
    ],
    "staffsetcostume": [
        "id",
        "costume"
    ],
    "staffsetname": [
        "id",
        "name:string"
    ],
    "staffsetorders": [
        "id",
        "staffOrders"
    ],
    "staffsetpatrolarea": [
        "id",
        "x1",
        "y1",
        "x2",
        "y2",
        "mode"
    ],
    "surfacesetstyle": [
        "x1",
        "y1",
        "x2",
        "y2",
        "surfaceStyle",
        "edgeStyle",
        "surfaceColour1",
        "edgeColour1"
    ],
    "tilemodify": [
        "x",
        "y",
        "setting",
        "value1",
        "value2"
    ],
    "trackdesign": [
        "x",
        "y",
        "z",
        "direction"
    ],
    "trackplace": [
        "x",
        "y",
        "z",
        "direction",
        "ride",
        "trackType",
        "rideType",
        "brakeSpeed",
        "colour",
        "seatRotation",
        "trackPlaceFlags",
        "isFromTrackDesign:bool"
    ],
    "trackremove": [
        "x",
        "y",
        "z",
        "direction",
        "trackType",
        "sequence"
    ],
    "tracksetbrakespeed": [
        "x",
        "y",
        "z",
        "trackType",
        "brakeSpeed"
    ],
    "wallplace": [
        "x",
        "y",
        "z",
        "object",
        "edge",
        "primaryColour",
        "secondaryColour",
        "tertiaryColour"
    ],
    "wallremove": [
        "x",
        "y",
        "z",
        "direction"
    ],
    "wallsetcolour": [
        "x",
        "y",
        "z",
        "direction",
        "primaryColour",
        "secondaryColour",
        "tertiaryColour"
    ],
    "waterlower": [
        "x1",
        "y1",
        "x2",
        "y2"
    ],
    "waterraise": [
        "x1",
        "y1",
        "x2",
        "y2"
    ],
    "watersetheight": [
        "x",
        "y",
        "height"
    ]
};
