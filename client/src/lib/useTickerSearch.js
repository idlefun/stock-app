import { useState, useEffect, useRef } from 'react';
import { api } from './api';

export function useTickerSearch(ticker, enabled = true) {
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = ticker.trim();
    if (q.length < 1) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchTicker(q);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [ticker, enabled]);

  function selectTicker(result) {
    setShowDropdown(false);
    setSearchResults([]);
    return result.ticker;
  }

  function clearSearch() {
    setSearchResults([]);
    setShowDropdown(false);
  }

  return { searchResults, showDropdown, searching, selectTicker, clearSearch };
}
