import React, { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';

function App() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-pink-100 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl border-b-8 border-pink-300 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🧸</div>
          <h1 className="text-3xl font-black text-pink-500 mb-2">Kawaii Claw AR</h1>
          <p className="text-gray-500 mb-6">Use your hand to control the claw machine!</p>
          
          <div className="bg-pink-50 rounded-xl p-4 mb-6 text-left space-y-3">
             <div className="flex items-center gap-3">
                <span className="bg-blue-100 text-blue-600 p-2 rounded-lg text-xl">☝️</span>
                <span className="text-gray-600 font-bold">POINT to Move</span>
             </div>
             <div className="flex items-center gap-3">
                <span className="bg-pink-100 text-pink-600 p-2 rounded-lg text-xl">👌</span>
                <span className="text-gray-600 font-bold">PINCH to Grab</span>
             </div>
             <div className="flex items-center gap-3">
                <span className="bg-green-100 text-green-600 p-2 rounded-lg text-xl">✋</span>
                <span className="text-gray-600 font-bold">OPEN to Drop</span>
             </div>
          </div>

          <button 
            onClick={() => setStarted(true)}
            className="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold text-xl py-4 rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            START GAME
          </button>
          <p className="mt-4 text-xs text-gray-400">Requires Camera Permission</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen relative">
      <GameCanvas />
    </div>
  );
}

export default App;
