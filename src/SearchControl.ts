import L, { ControlPosition, FeatureGroup, MarkerOptions, Map } from 'leaflet';
import SearchElement from './SearchElement';
import ResultList from './resultList';
import debounce from './lib/debounce';

import { createElement, addClassName, removeClassName } from './domUtils';
import {
  ENTER_KEY,
  SPECIAL_KEYS,
  ARROW_UP_KEY,
  ARROW_DOWN_KEY,
  ESCAPE_KEY,
} from './constants';
import AbstractProvider, { SearchResult } from './providers/provider';
import { Provider } from './providers';

const defaultOptions: Omit<SearchControlProps, 'provider'> = {
  position: 'topleft',
  style: 'button',
  showMarker: true,
  showPopup: false,
  popupFormat: ({ result }) => `${result.label}`,
  marker: {
    icon: L && L.Icon ? new L.Icon.Default() : undefined,
    draggable: false,
  },
  maxMarkers: 1,
  retainZoomLevel: false,
  animateZoom: true,
  searchLabel: 'Enter address',
  notFoundMessage: 'Sorry, that address could not be found.',
  messageHideDelay: 3000,
  zoomLevel: 18,
  classNames: {
    container: 'leaflet-bar leaflet-control leaflet-control-geosearch',
    button: 'leaflet-bar-part leaflet-bar-part-single',
    resetButton: 'reset',
    msgbox: 'leaflet-bar message',
    form: '',
    input: '',
  },
  autoComplete: true,
  autoCompleteDelay: 250,
  autoClose: false,
  keepResult: false,
};

const wasHandlerEnabled: { [key in MapHandler]?: boolean } = {};
type MapHandler =
  | 'dragging'
  | 'touchZoom'
  | 'doubleClickZoom'
  | 'scrollWheelZoom'
  | 'boxZoom'
  | 'keyboard';

const mapHandlers: MapHandler[] = [
  'dragging',
  'touchZoom',
  'doubleClickZoom',
  'scrollWheelZoom',
  'boxZoom',
  'keyboard',
];

const UNINITIALIZED_ERR =
  'Leaflet must be loaded before instantiating the GeoSearch control';

interface SearchControlProps {
  /** the provider to use for searching */
  provider: Provider;
  /** the leaflet position to render the element in */
  position: ControlPosition;
  /**
   * the stye of the search element
   * @default bar
   **/
  style: 'button' | 'bar';

  marker: MarkerOptions;
  maxMarkers: number;
  showMarker: boolean;
  showPopup: boolean;
  popupFormat<T = any>(args: {
    query: Selection;
    result: SearchResult<T>;
  }): string;

  searchLabel: string;
  notFoundMessage: string;
  messageHideDelay: number;

  animateZoom: boolean;
  zoomLevel: number;
  retainZoomLevel: boolean;

  classNames: {
    container: string;
    button: string;
    resetButton: string;
    msgbox: string;
    form: string;
    input: string;
  };

  autoComplete: boolean;
  autoCompleteDelay: number;
  autoClose: boolean;
  keepResult: boolean;
}

export type SearchControlOptions = Partial<SearchControlProps> & {
  provider: Provider;
};

interface Selection {
  query: string;
  data?: SearchResult;
}

interface SearchControl {
  options: Omit<SearchControlProps, 'provider'> & {
    provider?: SearchControlProps['provider'];
  };
  markers: FeatureGroup;
  handlersDisabled: boolean;
  searchElement: SearchElement;
  resultList: ResultList;
  classNames: SearchControlProps['classNames'];
  container: HTMLDivElement;
  input: HTMLInputElement;
  map: Map;

  // [key: string]: any;
  initialize(options: SearchControlProps): void;
  onSubmit(result: Selection): void;
  onClick(event: Event): void;
  clearResults(event?: KeyboardEvent | null, force?: boolean): void;
  autoSearch(event: KeyboardEvent): void;
  selectResult(event: KeyboardEvent): void;
  disableHandlers(event: Event): void;
  restoreHandlers(event?: Event): void;
  showResult(result: SearchResult, query: Selection): void;
  addMarker(result: SearchResult, selection: Selection): void;
  centerMap(result: SearchResult): void;
  closeResults(): void;
  getZoom(): number;
  onAdd(map: Map): HTMLDivElement;
  onRemove(): SearchControl;
}

// @ts-ignore
const Control: SearchControl = {
  options: defaultOptions,
  handlersDisabled: false,
  classNames: defaultOptions.classNames,

  initialize(options: SearchControlOptions) {
    if (!L) {
      throw new Error(UNINITIALIZED_ERR);
    }

    if (!options.provider) {
      throw new Error('Provider is missing from options');
    }

    // merge given options with control defaults
    Object.assign(this.options, options);
    Object.assign(this.classNames, options.classNames);

    this.markers = new L.FeatureGroup();
    this.classNames.container += ` geosearch-${this.options.style}`;

    this.searchElement = new SearchElement({
      handleSubmit: (result) => this.onSubmit(result),
    });

    const button = createElement<HTMLAnchorElement>(
      'a',
      this.classNames.button,
      this.searchElement.container,
      {
        title: this.options.searchLabel,
        href: '#',
        onClick: (e) => this.onClick(e),
      },
    );

    const resetButton = createElement<HTMLAnchorElement>(
      'a',
      this.classNames.resetButton,
      this.searchElement.form,
      {
        text: 'X',
        href: '#',
        onClick: () => this.clearResults(null, true),
      },
    );

    if (this.options.autoComplete) {
      this.resultList = new ResultList({
        handleClick: ({ result }) => {
          this.searchElement.input.value = result.label;
          this.onSubmit({ query: result.label, data: result });
        },
      });

      this.searchElement.form.appendChild(this.resultList.container);

      this.searchElement.input.addEventListener(
        'keyup',
        debounce(
          (e: KeyboardEvent) => this.autoSearch(e),
          this.options.autoCompleteDelay,
        ),
        true,
      );

      this.searchElement.input.addEventListener(
        'keydown',
        (e: KeyboardEvent) => this.selectResult(e),
        true,
      );

      this.searchElement.input.addEventListener(
        'keydown',
        (e: KeyboardEvent) => this.clearResults(e, true),
        true,
      );
    }

    this.searchElement.form.addEventListener(
      'mouseenter',
      (e) => this.disableHandlers(e),
      true,
    );

    this.searchElement.form.addEventListener(
      'mouseleave',
      () => this.restoreHandlers(),
      true,
    );

    this.searchElement.form.addEventListener(
      'click',
      (e) => e.preventDefault(),
      false,
    );
  },

  onAdd(map: Map) {
    const { showMarker, style } = this.options;

    this.map = map;
    if (showMarker) {
      this.markers.addTo(map);
    }

    if (style === 'bar') {
      const root = map
        .getContainer()
        .querySelector('.leaflet-control-container');

      this.container = createElement<HTMLDivElement>(
        'div',
        'leaflet-control-geosearch bar',
      );

      this.container.appendChild(this.searchElement.form);
      root!.appendChild(this.container);
    }

    return this.searchElement.container;
  },

  onRemove() {
    this.container?.remove();
    return this;
  },

  onClick(event: Event) {
    event.preventDefault();

    if (this.container.classList.contains('active')) {
      removeClassName(this.container, 'active');
      this.clearResults();
    } else {
      addClassName(this.container, 'active');
      this.input.focus();
    }
  },

  disableHandlers(event) {
    if (!this.searchElement.form.contains(event.target as Node)) {
      return;
    }

    mapHandlers.forEach((handler) => {
      wasHandlerEnabled[handler] = this.map[handler]?.enabled();
      this.map[handler]?.disable();
    });
  },

  restoreHandlers(event: Event) {
    if (event && !this.searchElement.form.includes(event.target as Node)) {
      return;
    }

    mapHandlers.forEach((handler) => {
      if (wasHandlerEnabled[handler]) {
        this.map[handler]?.enable();
      }
    });
  },

  selectResult(event) {
    if (
      [ENTER_KEY, ARROW_DOWN_KEY, ARROW_UP_KEY].indexOf(event.keyCode) === -1
    ) {
      return;
    }

    event.preventDefault();

    if (event.keyCode === ENTER_KEY) {
      const item = this.resultList.select(this.resultList.selected);
      this.onSubmit({ query: this.searchElement.input.value, data: item });
      return;
    }

    const max = this.resultList.count() - 1;
    if (max < 0) {
      return;
    }

    const { selected } = this.resultList;
    const next = event.keyCode === ARROW_DOWN_KEY ? selected + 1 : selected - 1;
    const idx = next < 0 ? max : next > max ? 0 : next;

    const item = this.resultList.select(idx);
    this.searchElement.input.value = item.label;
  },

  clearResults(event: KeyboardEvent | null, force = false) {
    if (event && event.keyCode !== ESCAPE_KEY) {
      return;
    }

    const { keepResult, autoComplete } = this.options;

    if (force || !keepResult) {
      this.searchElement.input.value = '';
      this.markers.clearLayers();
    }

    if (autoComplete) {
      this.resultList.clear();
    }
  },

  async autoSearch(event) {
    if (SPECIAL_KEYS.indexOf(event.keyCode) > -1) {
      return;
    }

    const query = (event.target as HTMLInputElement).value;
    const { provider } = this.options;

    if (query.length) {
      const results = await provider!.search({ query });
      this.resultList.render(results);
    } else {
      this.resultList.clear();
    }
  },

  async onSubmit(query) {
    const { provider } = this.options;

    const results = await provider!.search(query);

    if (results && results.length > 0) {
      this.showResult(results[0], query);
    }
  },

  showResult(result, query) {
    const { autoClose } = this.options;

    // @ts-ignore
    const markers = Object.keys(this.markers._layers);
    if (markers.length >= this.options.maxMarkers) {
      // @ts-ignore
      this.markers.removeLayer(markers[0]);
    }

    const marker = this.addMarker(result, query);
    this.centerMap(result);

    this.map.fireEvent('geosearch/showlocation', {
      location: result,
      marker,
    });

    if (autoClose) {
      this.closeResults();
    }
  },

  closeResults() {
    const { container } = this.searchElement;

    if (container.classList.contains('active')) {
      removeClassName(container, 'active');
    }

    this.restoreHandlers();
    this.clearResults();
  },

  addMarker(result, query) {
    const { marker: options, showPopup, popupFormat } = this.options;
    const marker = new L.Marker([result.y, result.x], options);
    let popupLabel = result.label;

    if (typeof popupFormat === 'function') {
      popupLabel = popupFormat({ query, result });
    }

    marker.bindPopup(popupLabel);

    this.markers.addLayer(marker);

    if (showPopup) {
      marker.openPopup();
    }

    if (options.draggable) {
      marker.on('dragend', (args) => {
        this.map.fireEvent('geosearch/marker/dragend', {
          location: marker.getLatLng(),
          event: args,
        });
      });
    }

    return marker;
  },

  centerMap(result) {
    const { retainZoomLevel, animateZoom } = this.options;

    const resultBounds = new L.LatLngBounds(result.bounds);
    const bounds = resultBounds.isValid()
      ? resultBounds
      : this.markers.getBounds();

    if (!retainZoomLevel && resultBounds.isValid()) {
      this.map.fitBounds(bounds, { animate: animateZoom });
    } else {
      this.map.setView(bounds.getCenter(), this.getZoom(), {
        animate: animateZoom,
      });
    }
  },

  getZoom(): number {
    const { retainZoomLevel, zoomLevel } = this.options;
    return retainZoomLevel ? this.map.getZoom() : zoomLevel;
  },
};

export default function SearchControl(...options: any[]) {
  if (!L) {
    throw new Error(UNINITIALIZED_ERR);
  }

  const LControl = L.Control.extend(Control);
  return new LControl(...options);
}
