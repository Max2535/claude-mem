import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LogConsole } from './LogConsole';

interface LogsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The floating console: a resizable shell around <LogConsole>. Everything that
 * reads, parses and filters the log lives in that component, which the System
 * screen mounts too — this file owns only the drag-to-resize edge and the
 * fixed position, which is all that makes it a drawer.
 */
export function LogsDrawer({ isOpen, onClose }: LogsDrawerProps) {
  const [height, setHeight] = useState(350);
  const [isResizing, setIsResizing] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = height;
  }, [height]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY;
      const newHeight = Math.min(Math.max(150, startHeightRef.current + deltaY), window.innerHeight - 100);
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="console-drawer" style={{ height: `${height}px` }}>
      <div className="console-resize-handle" onMouseDown={handleMouseDown}>
        <div className="console-resize-bar" />
      </div>

      <LogConsole onClose={onClose} />
    </div>
  );
}
