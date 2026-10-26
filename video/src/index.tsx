import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FolioFilm, movieFrames, previewPlaybackRate } from './Film';

const Root: React.FC = () => <>
  <Composition id="FolioIntro" component={FolioFilm} width={2560} height={1440} fps={30} durationInFrames={movieFrames} defaultProps={{ preview: false, sound: true }}/>
  <Composition id="FolioPreview" component={FolioFilm} width={2560} height={1440} fps={12} durationInFrames={Math.ceil(movieFrames / 30 / previewPlaybackRate * 12)} defaultProps={{ preview: true, sound: false, playbackRate: previewPlaybackRate }}/>
</>;

registerRoot(Root);
