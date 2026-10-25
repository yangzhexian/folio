import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FolioFilm } from './Film';

const Root: React.FC = () => <>
  <Composition id="FolioIntro" component={FolioFilm} width={1920} height={1080} fps={30} durationInFrames={1260} defaultProps={{ preview: false, sound: true }}/>
  <Composition id="FolioPreview" component={FolioFilm} width={1920} height={1080} fps={12} durationInFrames={144} defaultProps={{ preview: true, sound: false }}/>
</>;

registerRoot(Root);
