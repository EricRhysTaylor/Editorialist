// Canonical provider brand marks for contributor avatars.
// The AnthropIc / Claude SVG is preserved here from the user-provided asset
// so the exact logo remains reusable in future contributor surfaces.

export type ContributorBrand = "openai" | "anthropic" | "gemini" | "grok";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

type SvgAttributes = Record<string, string>;

let brandMarkInstanceCount = 0;

const appendSvgElement = (
	parent: SVGElement,
	tag: string,
	attributes: SvgAttributes,
): SVGElement => {
	const element = document.createElementNS(SVG_NAMESPACE, tag);
	for (const [key, value] of Object.entries(attributes)) {
		element.setAttribute(key, value);
	}
	parent.appendChild(element);
	return element;
};

export const renderContributorBrandMark = (
	parent: HTMLElement,
	brand: ContributorBrand,
): void => {
	parent.empty();
	const instanceId = `editorialist-brand-${brand}-${++brandMarkInstanceCount}`;

	const svg = document.createElementNS(SVG_NAMESPACE, "svg");
	svg.setAttribute("fill", "none");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("editorialist-settings__brand-mark");

	switch (brand) {
		case "openai":
			svg.setAttribute("viewBox", "0 0 512 509.639");
			svg.setAttribute("shape-rendering", "geometricPrecision");
			svg.setAttribute("text-rendering", "geometricPrecision");
			svg.setAttribute("image-rendering", "optimizeQuality");
			appendSvgElement(svg, "path", {
				fill: "#fff",
				d: "M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.613-115.613 115.613H115.612C52.026 509.64 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z",
			});
			appendSvgElement(svg, "path", {
				fill: "#000",
				"fill-rule": "nonzero",
				d: "M412.037 221.764a90.834 90.834 0 004.648-28.67 90.79 90.79 0 00-12.443-45.87c-16.37-28.496-46.738-46.089-79.605-46.089-6.466 0-12.943.683-19.264 2.04a90.765 90.765 0 00-67.881-30.515h-.576c-.059.002-.149.002-.216.002-39.807 0-75.108 25.686-87.346 63.554-25.626 5.239-47.748 21.31-60.682 44.03a91.873 91.873 0 00-12.407 46.077 91.833 91.833 0 0023.694 61.553 90.802 90.802 0 00-4.649 28.67 90.804 90.804 0 0012.442 45.87c16.369 28.504 46.74 46.087 79.61 46.087a91.81 91.81 0 0019.253-2.04 90.783 90.783 0 0067.887 30.516h.576l.234-.001c39.829 0 75.119-25.686 87.357-63.588 25.626-5.242 47.748-21.312 60.682-44.033a91.718 91.718 0 0012.383-46.035 91.83 91.83 0 00-23.693-61.553l-.004-.005zM275.102 413.161h-.094a68.146 68.146 0 01-43.611-15.8 56.936 56.936 0 002.155-1.221l72.54-41.901a11.799 11.799 0 005.962-10.251V241.651l30.661 17.704c.326.163.55.479.596.84v84.693c-.042 37.653-30.554 68.198-68.21 68.273h.001zm-146.689-62.649a68.128 68.128 0 01-9.152-34.085c0-3.904.341-7.817 1.005-11.663.539.323 1.48.897 2.155 1.285l72.54 41.901a11.832 11.832 0 0011.918-.002l88.563-51.137v35.408a1.1 1.1 0 01-.438.94l-73.33 42.339a68.43 68.43 0 01-34.11 9.12 68.359 68.359 0 01-59.15-34.11l-.001.004zm-19.083-158.36a68.044 68.044 0 0135.538-29.934c0 .625-.036 1.731-.036 2.5v83.801l-.001.07a11.79 11.79 0 005.954 10.242l88.564 51.13-30.661 17.704a1.096 1.096 0 01-1.034.093l-73.337-42.375a68.36 68.36 0 01-34.095-59.143 68.412 68.412 0 019.112-34.085l-.004-.003zm251.907 58.621l-88.563-51.137 30.661-17.697a1.097 1.097 0 011.034-.094l73.337 42.339c21.109 12.195 34.132 34.746 34.132 59.132 0 28.604-17.849 54.199-44.686 64.078v-86.308c.004-.032.004-.065.004-.096 0-4.219-2.261-8.119-5.919-10.217zm30.518-45.93c-.539-.331-1.48-.898-2.155-1.286l-72.54-41.901a11.842 11.842 0 00-5.958-1.611c-2.092 0-4.15.558-5.957 1.611l-88.564 51.137v-35.408l-.001-.061a1.1 1.1 0 01.44-.88l73.33-42.303a68.301 68.301 0 0134.108-9.129c37.704 0 68.281 30.577 68.281 68.281a68.69 68.69 0 01-.984 11.545v.005zm-191.843 63.109l-30.668-17.704a1.09 1.09 0 01-.596-.84v-84.692c.016-37.685 30.593-68.236 68.281-68.236a68.332 68.332 0 0143.689 15.804 63.09 63.09 0 00-2.155 1.222l-72.54 41.9a11.794 11.794 0 00-5.961 10.248v.068l-.05 102.23zm16.655-35.91l39.445-22.782 39.444 22.767v45.55l-39.444 22.767-39.445-22.767v-45.535z",
			});
			break;
		case "anthropic":
			svg.setAttribute("viewBox", "0 0 512 509.64");
			svg.setAttribute("shape-rendering", "geometricPrecision");
			svg.setAttribute("text-rendering", "geometricPrecision");
			svg.setAttribute("image-rendering", "optimizeQuality");
			appendSvgElement(svg, "path", {
				fill: "#D77655",
				d: "M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z",
			});
			appendSvgElement(svg, "path", {
				fill: "#FCF2EE",
				"fill-rule": "nonzero",
				d: "M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z",
			});
			break;
		case "gemini":
			svg.setAttribute("viewBox", "0 0 65 65");
			{
				const maskId = `${instanceId}-mask`;
				const paintId = `${instanceId}-paint`;
				const filter0Id = `${instanceId}-filter0`;
				const filter1Id = `${instanceId}-filter1`;
				const filter2Id = `${instanceId}-filter2`;
				const filter3Id = `${instanceId}-filter3`;
				const filter4Id = `${instanceId}-filter4`;
				const filter5Id = `${instanceId}-filter5`;
				const filter6Id = `${instanceId}-filter6`;
				const filter7Id = `${instanceId}-filter7`;
				const filter8Id = `${instanceId}-filter8`;
				const filter9Id = `${instanceId}-filter9`;
				const filter10Id = `${instanceId}-filter10`;

				const mask = appendSvgElement(svg, "mask", {
					id: maskId,
					style: "mask-type:alpha",
					"maskUnits": "userSpaceOnUse",
					x: "0",
					y: "0",
					width: "65",
					height: "65",
				});
				appendSvgElement(mask, "path", {
					d: "M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z",
					fill: "#000",
				});
				appendSvgElement(mask, "path", {
					d: "M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z",
					fill: `url(#${paintId})`,
				});

				const group = appendSvgElement(svg, "g", { mask: `url(#${maskId})` });
				const blur0 = appendSvgElement(group, "g", { filter: `url(#${filter0Id})` });
				appendSvgElement(blur0, "path", {
					d: "M-5.859 50.734c7.498 2.663 16.116-2.33 19.249-11.152 3.133-8.821-.406-18.131-7.904-20.794-7.498-2.663-16.116 2.33-19.25 11.151-3.132 8.822.407 18.132 7.905 20.795z",
					fill: "#FFE432",
				});
				const blur1 = appendSvgElement(group, "g", { filter: `url(#${filter1Id})` });
				appendSvgElement(blur1, "path", {
					d: "M27.433 21.649c10.3 0 18.651-8.535 18.651-19.062 0-10.528-8.35-19.062-18.651-19.062S8.78-7.94 8.78 2.587c0 10.527 8.35 19.062 18.652 19.062z",
					fill: "#FC413D",
				});
				const blur2 = appendSvgElement(group, "g", { filter: `url(#${filter2Id})` });
				appendSvgElement(blur2, "path", {
					d: "M20.184 82.608c10.753-.525 18.918-12.244 18.237-26.174-.68-13.93-9.95-24.797-20.703-24.271C6.965 32.689-1.2 44.407-.519 58.337c.681 13.93 9.95 24.797 20.703 24.271z",
					fill: "#00B95C",
				});
				const blur3 = appendSvgElement(group, "g", { filter: `url(#${filter3Id})` });
				appendSvgElement(blur3, "path", {
					d: "M20.184 82.608c10.753-.525 18.918-12.244 18.237-26.174-.68-13.93-9.95-24.797-20.703-24.271C6.965 32.689-1.2 44.407-.519 58.337c.681 13.93 9.95 24.797 20.703 24.271z",
					fill: "#00B95C",
				});
				const blur4 = appendSvgElement(group, "g", { filter: `url(#${filter4Id})` });
				appendSvgElement(blur4, "path", {
					d: "M30.954 74.181c9.014-5.485 11.427-17.976 5.389-27.9-6.038-9.925-18.241-13.524-27.256-8.04-9.015 5.486-11.428 17.977-5.39 27.902 6.04 9.924 18.242 13.523 27.257 8.038z",
					fill: "#00B95C",
				});
				const blur5 = appendSvgElement(group, "g", { filter: `url(#${filter5Id})` });
				appendSvgElement(blur5, "path", {
					d: "M67.391 42.993c10.132 0 18.346-7.91 18.346-17.666 0-9.757-8.214-17.667-18.346-17.667s-18.346 7.91-18.346 17.667c0 9.757 8.214 17.666 18.346 17.666z",
					fill: "#3186FF",
				});
				const blur6 = appendSvgElement(group, "g", { filter: `url(#${filter6Id})` });
				appendSvgElement(blur6, "path", {
					d: "M-13.065 40.944c9.33 7.094 22.959 4.869 30.442-4.972 7.483-9.84 5.987-23.569-3.343-30.663C4.704-1.786-8.924.439-16.408 10.28c-7.483 9.84-5.986 23.57 3.343 30.664z",
					fill: "#FBBC04",
				});
				const blur7 = appendSvgElement(group, "g", { filter: `url(#${filter7Id})` });
				appendSvgElement(blur7, "path", {
					d: "M34.74 51.43c11.135 7.656 25.896 5.524 32.968-4.764 7.073-10.287 3.779-24.832-7.357-32.488C49.215 6.52 34.455 8.654 27.382 18.94c-7.072 10.288-3.779 24.833 7.357 32.49z",
					fill: "#3186FF",
				});
				const blur8 = appendSvgElement(group, "g", { filter: `url(#${filter8Id})` });
				appendSvgElement(blur8, "path", {
					d: "M54.984-2.336c2.833 3.852-.808 11.34-8.131 16.727-7.324 5.387-15.557 6.631-18.39 2.78-2.833-3.853.807-11.342 8.13-16.728 7.324-5.387 15.558-6.631 18.39-2.78z",
					fill: "#749BFF",
				});
				const blur9 = appendSvgElement(group, "g", { filter: `url(#${filter9Id})` });
				appendSvgElement(blur9, "path", {
					d: "M31.727 16.104C43.053 5.598 46.94-8.626 40.41-15.666c-6.53-7.04-21.006-4.232-32.332 6.274s-15.214 24.73-8.683 31.77c6.53 7.04 21.006 4.232 32.332-6.274z",
					fill: "#FC413D",
				});
				const blur10 = appendSvgElement(group, "g", { filter: `url(#${filter10Id})` });
				appendSvgElement(blur10, "path", {
					d: "M8.51 53.838c6.732 4.818 14.46 5.55 17.262 1.636 2.802-3.915-.384-10.994-7.116-15.812-6.731-4.818-14.46-5.55-17.261-1.636-2.802 3.915.383 10.994 7.115 15.812z",
					fill: "#FFEE48",
				});

				const defs = appendSvgElement(svg, "defs", {});
				const filterDefinitions: Array<{
					id: string;
					x: string;
					y: string;
					width: string;
					height: string;
					blur: string;
				}> = [
					{ id: filter0Id, x: "-19.824", y: "13.152", width: "39.274", height: "43.217", blur: "2.46" },
					{ id: filter1Id, x: "-15.001", y: "-40.257", width: "84.868", height: "85.688", blur: "11.891" },
					{ id: filter2Id, x: "-20.776", y: "11.927", width: "79.454", height: "90.916", blur: "10.109" },
					{ id: filter3Id, x: "-20.776", y: "11.927", width: "79.454", height: "90.916", blur: "10.109" },
					{ id: filter4Id, x: "-19.845", y: "15.459", width: "79.731", height: "81.505", blur: "10.109" },
					{ id: filter5Id, x: "29.832", y: "-11.552", width: "75.117", height: "73.758", blur: "9.606" },
					{ id: filter6Id, x: "-38.583", y: "-16.253", width: "78.135", height: "78.758", blur: "8.706" },
					{ id: filter7Id, x: "8.107", y: "-5.966", width: "78.877", height: "77.539", blur: "7.775" },
					{ id: filter8Id, x: "13.587", y: "-18.488", width: "56.272", height: "51.81", blur: "6.957" },
					{ id: filter9Id, x: "-15.526", y: "-31.297", width: "70.856", height: "69.306", blur: "5.876" },
					{ id: filter10Id, x: "-14.168", y: "20.964", width: "55.501", height: "51.571", blur: "7.273" },
				];
				filterDefinitions.forEach(({ id, x, y, width, height, blur }) => {
					const filter = appendSvgElement(defs, "filter", {
						id,
						x,
						y,
						width,
						height,
						filterUnits: "userSpaceOnUse",
						"color-interpolation-filters": "sRGB",
					});
					appendSvgElement(filter, "feFlood", {
						"flood-opacity": "0",
						result: "BackgroundImageFix",
					});
					appendSvgElement(filter, "feBlend", {
						in: "SourceGraphic",
						in2: "BackgroundImageFix",
						result: "shape",
					});
					appendSvgElement(filter, "feGaussianBlur", {
						stdDeviation: blur,
						result: "effect1_foregroundBlur_2001_67",
					});
				});
				const gradient = appendSvgElement(defs, "linearGradient", {
					id: paintId,
					x1: "18.447",
					y1: "43.42",
					x2: "52.153",
					y2: "15.004",
					gradientUnits: "userSpaceOnUse",
				});
				appendSvgElement(gradient, "stop", {
					"stop-color": "#4893FC",
				});
				appendSvgElement(gradient, "stop", {
					offset: ".27",
					"stop-color": "#4893FC",
				});
				appendSvgElement(gradient, "stop", {
					offset: ".777",
					"stop-color": "#969DFF",
				});
				appendSvgElement(gradient, "stop", {
					offset: "1",
					"stop-color": "#BD99FE",
				});
			}
			break;
		case "grok":
			svg.setAttribute("viewBox", "0 0 512 509.641");
			svg.setAttribute("shape-rendering", "geometricPrecision");
			svg.setAttribute("text-rendering", "geometricPrecision");
			svg.setAttribute("image-rendering", "optimizeQuality");
			appendSvgElement(svg, "path", {
				d: "M115.612 0h280.776C459.975 0 512 52.026 512 115.612v278.416c0 63.587-52.025 115.613-115.612 115.613H115.612C52.026 509.641 0 457.615 0 394.028V115.612C0 52.026 52.026 0 115.612 0z",
			});
			appendSvgElement(svg, "path", {
				fill: "#fff",
				d: "M213.235 306.019l178.976-180.002v.169l51.695-51.763c-.924 1.32-1.86 2.605-2.785 3.89-39.281 54.164-58.46 80.649-43.07 146.922l-.09-.101c10.61 45.11-.744 95.137-37.398 131.836-46.216 46.306-120.167 56.611-181.063 14.928l42.462-19.675c38.863 15.278 81.392 8.57 111.947-22.03 30.566-30.6 37.432-75.159 22.065-112.252-2.92-7.025-11.67-8.795-17.792-4.263l-124.947 92.341zm-25.786 22.437l-.033.034L68.094 435.217c7.565-10.429 16.957-20.294 26.327-30.149 26.428-27.803 52.653-55.359 36.654-94.302-21.422-52.112-8.952-113.177 30.724-152.898 41.243-41.254 101.98-51.661 152.706-30.758 11.23 4.172 21.016 10.114 28.638 15.639l-42.359 19.584c-39.44-16.563-84.629-5.299-112.207 22.313-37.298 37.308-44.84 102.003-1.128 143.81z",
			});
			break;
	}

	parent.appendChild(svg);
};
