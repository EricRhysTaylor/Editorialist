// Radial Timeline "RT" wordmark, registered as an Obsidian icon so it can be
// used like any built-in icon (badges, watermarks) via setIcon. Source:
// Brand/logo RT.svg (48x48 vector; the mark occupies the centre band). Scaled
// to Obsidian's 0-100 icon box (48 * 2.08333 ≈ 100) and recoloured to
// currentColor so it follows the theme like every other UI icon — no separate
// light/dark asset, and hex-free so it passes the brand-colour audit.
// Regenerate from the source SVG if the mark changes.
import { addIcon } from "obsidian";

export const RADIAL_TIMELINE_ICON_ID = "radial-timeline-logo";

const RADIAL_TIMELINE_ICON_SVG =
	"<g transform=\"scale(2.08333)\" fill=\"currentColor\"><path d=\"M7.61209 37.965L0 37.9719L2.11144 28.4928C2.82871 25.2722 5.42882 22.9945 8.71841 22.9951H15.8193C16.4091 22.9956 16.9744 22.8789 17.4777 22.6067C18.3035 22.161 18.68 21.2951 18.5887 20.3778C18.4535 19.0137 17.4174 18.3839 16.1344 18.3086L4.50706 18.3048L6.19275 11L16.8774 11.0069C20.9094 11.2085 24.265 13.6311 25.6534 17.4517C26.7252 20.5895 26.1101 23.9946 24.06 26.5812C23.0644 27.8375 21.7845 28.7692 20.3096 29.4505L24.4648 37.8844C24.5167 37.9899 24.5686 38.0356 24.4003 37.9671L16.1968 37.9692L12.4458 30.4617L9.36489 30.4543L7.61314 37.9661V37.965H7.61209Z\"/><path d=\"M26.851 37.9703L27.8724 33.4254L31.3381 18.3181L28.7129 18.3048C28.1613 15.1448 26.2701 12.571 23.4597 11.0037L48 11.0016L46.3557 18.3064L38.8821 18.3096L34.353 37.9671L26.8505 37.9708H26.851V37.9703Z\"/></g>";

let registered = false;

export function registerRadialTimelineIcon(): void {
	if (registered) {
		return;
	}
	addIcon(RADIAL_TIMELINE_ICON_ID, RADIAL_TIMELINE_ICON_SVG);
	registered = true;
}
